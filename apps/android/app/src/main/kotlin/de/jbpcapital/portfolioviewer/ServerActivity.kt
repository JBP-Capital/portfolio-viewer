package de.jbpcapital.portfolioviewer

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * First start, and "Change server": asks for the server and accepts it only when its health check
 * names Portfolio Viewer, so the app never shows some other site as if it were the portfolio.
 */
class ServerActivity : Activity() {

    private lateinit var address: EditText
    private lateinit var message: TextView
    private lateinit var connect: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_server)
        findViewById<View>(R.id.root).padForSystemBars()
        address = findViewById(R.id.server)
        message = findViewById(R.id.message)
        connect = findViewById(R.id.connect)
        address.setText(AppSettings.server(this) ?: BuildConfig.DEFAULT_SERVER)
        address.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_GO) check()
            action == EditorInfo.IME_ACTION_GO
        }
        connect.setOnClickListener { check() }
        connect.requestFocus()
    }

    private fun check() {
        val server = ServerAddress.normalize(address.text.toString())
        if (server == null) {
            show(getString(R.string.server_invalid), error = true)
            return
        }
        connect.isEnabled = false
        show(getString(R.string.server_checking), error = false)
        Thread {
            val result = runCatching { check(server) }
            runOnUiThread {
                // The screen may have been closed while the server was checked.
                if (isFinishing || isDestroyed) return@runOnUiThread
                connect.isEnabled = true
                result.fold(
                    onSuccess = { found -> if (found != null) open(found) else show(getString(R.string.server_not_found), error = true) },
                    onFailure = { error -> show(getString(R.string.server_unreachable, error.message ?: error.javaClass.simpleName), error = true) },
                )
            }
        }.start()
    }

    private fun open(server: String) {
        AppSettings.setServer(this, server)
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }

    private fun show(text: String, error: Boolean) {
        message.text = text
        message.setTextColor(getColor(if (error) R.color.loss else R.color.muted))
        message.visibility = View.VISIBLE
    }

    /**
     * The server to store, or null when no Portfolio Viewer answers. An http address that redirects to
     * https on the same host is taken as https; no other redirect is followed.
     */
    private fun check(server: String): String? {
        val (status, location, body) = fetchHealth(server)
        if (status in 300..399) return ServerAddress.httpsUpgrade(server, location)?.let { upgraded -> check(upgraded) }
        return server.takeIf { ServerAddress.isPortfolioViewer(body) }
    }

    /** Status, redirect target and body of `/api/health`; a 503 (database down) still names the app. */
    private fun fetchHealth(server: String): Triple<Int, String?, String> {
        val connection = URL("$server/api/health").openConnection() as HttpURLConnection
        connection.connectTimeout = TIMEOUT_MS
        connection.readTimeout = TIMEOUT_MS
        connection.instanceFollowRedirects = false
        try {
            val status = connection.responseCode
            val stream = if (status < 400) connection.inputStream else connection.errorStream
            val body = stream?.use { readUpTo(it, MAX_BODY) }?.toString(Charsets.UTF_8) ?: ""
            return Triple(status, connection.getHeaderField("Location"), body)
        } finally {
            connection.disconnect()
        }
    }

    private fun readUpTo(stream: InputStream, limit: Int): ByteArray {
        val buffer = ByteArrayOutputStream()
        val chunk = ByteArray(1024)
        while (buffer.size() < limit) {
            val read = stream.read(chunk, 0, minOf(chunk.size, limit - buffer.size()))
            if (read < 0) break
            buffer.write(chunk, 0, read)
        }
        return buffer.toByteArray()
    }

    private companion object {
        const val TIMEOUT_MS = 10_000
        const val MAX_BODY = 4096
    }
}
