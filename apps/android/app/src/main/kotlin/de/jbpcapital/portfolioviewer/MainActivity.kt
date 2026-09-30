package de.jbpcapital.portfolioviewer

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.app.UiModeManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.text.Html
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import android.window.OnBackInvokedDispatcher

/**
 * The web app in a WebView: phones open the dashboard, TVs open TV mode (the page handles the remote itself).
 * Pages of other sites open in the browser; an unreachable server shows a local notice that retries by itself.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var server: String
    private val handler = Handler(Looper.getMainLooper())
    private val offline = OfflineState()
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var savedCookies: String? = null
    private val retry = Runnable { load() }
    // A server on the home network that is switched off often never answers instead of refusing
    private val loadTimeout = Runnable { showOffline("timeout") }

    private val isTv: Boolean by lazy {
        (getSystemService(UI_MODE_SERVICE) as UiModeManager).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
            packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val saved = AppSettings.server(this)
        if (saved == null) {
            startActivity(Intent(this, ServerActivity::class.java))
            finish()
            return
        }
        server = saved
        if (isTv) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        CookieManager.getInstance().setAcceptCookie(true)
        webView = WebView(this).apply {
            setBackgroundColor(getColor(R.color.background))
            settings.javaScriptEnabled = true
            // TV mode keeps the privacy choice in localStorage
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.userAgentString = "${settings.userAgentString} PortfolioViewerApp/${BuildConfig.VERSION_NAME}"
            isFocusable = true
            isFocusableInTouchMode = true
            webViewClient = Client()
            webChromeClient = Chrome()
            setDownloadListener { url, userAgent, contentDisposition, mimeType, _ -> download(url, userAgent, contentDisposition, mimeType) }
        }
        setContentView(framed(webView))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ (and the predictive back gesture): Back arrives through the dispatcher.
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { goBack() }
        }
        if (isTv) enterImmersiveMode()
        webView.requestFocus()
        val restored = savedInstanceState != null && webView.restoreState(savedInstanceState) != null
        // A restored offline notice (or nothing) is replaced by a fresh load of the server.
        if (!restored || webView.url?.let { ServerAddress.isSameOrigin(it, server) } != true) load()
        if (intent?.action == ACTION_CHANGE_SERVER) openServerScreen()
    }

    /**
     * Android 15+ draws every app edge to edge. On phones the page is kept clear of the status bar, the
     * navigation bar, display cutouts and the keyboard; TVs have none of them.
     */
    private fun framed(content: View): View {
        val frame = FrameLayout(this)
        frame.setBackgroundColor(getColor(R.color.background))
        frame.addView(content, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        if (!isTv) frame.padForSystemBars()
        return frame
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_CHANGE_SERVER) openServerScreen()
    }

    /** The server screen opens on top, so Back returns to the portfolio. */
    private fun openServerScreen() {
        startActivity(Intent(this, ServerActivity::class.java))
    }

    /** The Menu key of a TV remote changes the server; TV launchers show no app shortcuts. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (isTv && event.keyCode == KeyEvent.KEYCODE_MENU) {
            if (event.action == KeyEvent.ACTION_UP) openServerScreen()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun load() {
        handler.removeCallbacks(retry)
        handler.removeCallbacks(loadTimeout)
        handler.postDelayed(loadTimeout, LOAD_TIMEOUT_MS)
        offline.onLoadStarted()
        webView.loadUrl(ServerAddress.startUrl(server, isTv))
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::webView.isInitialized) webView.saveState(outState)
    }

    private fun goBack() {
        // The TV page first closes an open security detail or a marked card; only a Back it leaves unused goes on.
        webView.evaluateJavascript(ASK_PAGE_BACK) { used ->
            if (used == "true") return@evaluateJavascript
            // The task stays in memory, so reopening the app shows the page again without a reload.
            if (offline.backLeavesApp(isTv, webView.canGoBack())) moveTaskToBack(true) else webView.goBack()
        }
    }

    // Before Android 13 the Back key still arrives here; newer versions use the dispatcher above.
    @SuppressLint("GestureBackNavigation")
    @Suppress("DEPRECATION")
    @Deprecated("Replaced by OnBackInvokedDispatcher on Android 13 and later")
    override fun onBackPressed() {
        if (::webView.isInitialized) goBack() else super.onBackPressed()
    }

    override fun onResume() {
        super.onResume()
        if (!::webView.isInitialized) return
        webView.onResume()
        webView.resumeTimers()
        // Retries only run in the foreground; back in front, an offline app tries at once.
        if (offline.offline) load()
    }

    override fun onPause() {
        if (::webView.isInitialized) {
            // Keeps the sign-in (and a TV's device token) across app restarts
            CookieManager.getInstance().flush()
            handler.removeCallbacks(retry)
            handler.removeCallbacks(loadTimeout)
            webView.onPause()
            webView.pauseTimers()
        }
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacks(retry)
        handler.removeCallbacks(loadTimeout)
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && isTv) enterImmersiveMode()
    }

    @Suppress("DEPRECATION")
    private fun enterImmersiveMode() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    /** A local page instead of the browser's error page; it retries after 15 s, doubling up to 2 minutes. */
    private fun showOffline(reason: String) {
        handler.removeCallbacks(loadTimeout)
        val seconds = offline.onFailure()
        val html = OFFLINE_HTML
            .replace("{title}", Html.escapeHtml(getString(R.string.offline_title)))
            .replace("{retry}", Html.escapeHtml(resources.getQuantityString(R.plurals.offline_retry, seconds, seconds)))
            .replace("{tryNow}", Html.escapeHtml(getString(R.string.offline_try_now)))
            .replace("{change}", Html.escapeHtml(getString(R.string.offline_change_server)))
            .replace("{server}", Html.escapeHtml(server))
            .replace("{reason}", Html.escapeHtml(reason))
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
        handler.removeCallbacks(retry)
        handler.postDelayed(retry, seconds * 1000L)
    }

    /**
     * WebView writes cookies to disk only every few seconds; a fresh sign-in (or TV token) is written at
     * once, so it survives the app being killed right afterwards. Unchanged cookies cost no disk write.
     */
    private fun saveCookiesIfChanged() {
        val cookies = CookieManager.getInstance().getCookie(server)
        if (cookies == savedCookies) return
        savedCookies = cookies
        CookieManager.getInstance().flush()
    }

    private fun openInBrowser(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            // No browser on this device (some TVs): the link simply does nothing.
        }
    }

    /**
     * CSV exports need the sign-in, so the download carries the WebView's cookies for the server. The
     * export answers directly (no redirect), so the cookies go to the server only.
     */
    private fun download(url: String, userAgent: String, contentDisposition: String?, mimeType: String?) {
        if (!ServerAddress.isSameOrigin(url, server)) return
        val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
        try {
            val request = DownloadManager.Request(Uri.parse(url))
                .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                .addRequestHeader("User-Agent", userAgent)
                .setTitle(name)
                .setMimeType(mimeType)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            } else {
                // Android 7–9 would need the storage permission for Downloads; the app's own folder needs none.
                request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name)
            }
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            Toast.makeText(this, getString(R.string.download_started, name), Toast.LENGTH_SHORT).show()
        } catch (_: RuntimeException) {
            // Download manager disabled or storage unavailable: the browser can still fetch the file.
            openInBrowser(Uri.parse(url))
        }
    }

    @Deprecated("Deprecated in API 30; the file picker result still arrives here")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_FILE) return
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
        fileCallback = null
    }

    private inner class Client : WebViewClient() {

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            when {
                url.scheme == APP_SCHEME && url.host == "retry" -> load()
                url.scheme == APP_SCHEME && url.host == "server" -> openServerScreen()
                ServerAddress.isSameOrigin(url.toString(), server) -> return false
                // An embedded frame of another site never opens the browser by itself.
                !request.isForMainFrame -> return true
                url.scheme == "http" || url.scheme == "https" || url.scheme == "mailto" -> openInBrowser(url)
                // file:, content:, intent: and anything else never open inside the app
            }
            return true
        }

        // The web app changes pages without full loads (after signing in, too): each change is a history update.
        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            if (ServerAddress.isSameOrigin(url, server)) saveCookiesIfChanged()
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            if (url.startsWith("http")) handler.removeCallbacks(retry)
        }

        override fun onPageFinished(view: WebView, url: String) {
            // The offline notice is a data: page; only a real page of the server ends the outage.
            if (!ServerAddress.isSameOrigin(url, server)) return
            handler.removeCallbacks(loadTimeout)
            saveCookiesIfChanged()
            // After an outage, error and offline pages must not come back with Back.
            if (offline.onServerPageFinished()) view.clearHistory()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showOffline(error.description.toString())
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            // 5xx: server down or being redeployed, for example 502 from the proxy
            if (request.isForMainFrame && response.statusCode >= 500) showOffline("HTTP ${response.statusCode}")
        }

        /** A TV that runs for days can lose its page renderer (low memory); the app starts over instead of closing. */
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            recreate()
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            // Android 7–9 type .csv files as text/comma-separated-values, which a text/csv filter greys out.
            val picker = Intent(Intent.ACTION_GET_CONTENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*")
                .putExtra(Intent.EXTRA_MIME_TYPES, CSV_TYPES)
            return try {
                @Suppress("DEPRECATION")
                startActivityForResult(picker, REQUEST_FILE)
                true
            } catch (_: ActivityNotFoundException) {
                fileCallback = null
                Toast.makeText(this@MainActivity, R.string.file_picker_missing, Toast.LENGTH_LONG).show()
                false
            }
        }
    }

    companion object {
        const val ACTION_CHANGE_SERVER = "de.jbpcapital.portfolioviewer.CHANGE_SERVER"
        private const val APP_SCHEME = "pv-app"
        private const val REQUEST_FILE = 1
        private const val LOAD_TIMEOUT_MS = 30_000L
        /** The TV page's `window.pvTvBack()`; pages without it (and the offline notice) answer false. */
        private const val ASK_PAGE_BACK = "typeof window.pvTvBack === 'function' && window.pvTvBack() === true"
        private val CSV_TYPES = arrayOf("text/csv", "text/comma-separated-values", "application/csv", "text/plain")

        private const val OFFLINE_HTML = """<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#131313;color:#e2e2e2;font-family:sans-serif;text-align:center}
.box{max-width:40em;padding:2em}.brand{color:#e9c349;letter-spacing:.14em;text-transform:uppercase;font-size:.8em}
h1{font-size:1.6em;margin:.6em 0}.muted{color:#9d968a}.small{font-size:.85em;margin-top:2em}
a{display:inline-block;margin:1.2em .4em 0;padding:.7em 1.2em;background:#2a2a2a;color:#e9c349;text-decoration:none}
a:focus{outline:2px solid #e9c349}
</style></head><body><div class="box">
<div class="brand">Portfolio Viewer</div>
<h1>{title}</h1>
<div class="muted">{retry}</div>
<div><a href="pv-app://retry">{tryNow}</a><a href="pv-app://server">{change}</a></div>
<div class="muted small">{server} &middot; {reason}</div>
</div></body></html>"""
    }
}
