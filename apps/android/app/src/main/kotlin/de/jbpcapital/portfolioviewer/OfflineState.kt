package de.jbpcapital.portfolioviewer

/**
 * Whether the server is out of reach, how long to wait before the next attempt, and what Back does.
 * Plain Kotlin, so the rules run in JVM unit tests.
 */
class OfflineState {

    /** True from a failed load until a page of the server finishes loading again. */
    var offline = false
        private set
    private var attempt = 0
    // WebView reports a failed page as finished too; such a report must not end the outage.
    private var loadFailed = false

    fun onLoadStarted() {
        loadFailed = false
    }

    /** A main-frame load failed; returns the seconds until the next attempt (15, 30, 60, then every 120). */
    fun onFailure(): Int {
        loadFailed = true
        offline = true
        val seconds = (START_SECONDS shl minOf(attempt, 3)).coerceAtMost(MAX_SECONDS)
        attempt += 1
        return seconds
    }

    /**
     * A page of the server finished loading. Returns true when it ended an outage: the history then
     * holds error and offline pages and should be cleared.
     */
    fun onServerPageFinished(): Boolean {
        if (loadFailed) return false
        val recovered = offline
        offline = false
        attempt = 0
        return recovered
    }

    /** TV mode is one page, and an offline page has nothing to go back to: Back leaves the app. */
    fun backLeavesApp(isTv: Boolean, canGoBack: Boolean): Boolean = isTv || offline || !canGoBack

    private companion object {
        const val START_SECONDS = 15
        const val MAX_SECONDS = 120
    }
}
