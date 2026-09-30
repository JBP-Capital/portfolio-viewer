package de.jbpcapital.portfolioviewer

/** Rules for the Portfolio Viewer server the app talks to; plain Kotlin, so they run in JVM unit tests. */
object ServerAddress {

    private val SCHEME = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:")
    private val HOST_PORT_WITHOUT_SCHEME = Regex("^[^:/]+:\\d")
    // Scheme and authority only; paths and queries may hold characters java.net.URI refuses but browsers keep.
    private val ORIGIN = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*)://([^/?#]*)")
    private val HEALTH_APP = Regex("\"app\"\\s*:\\s*\"portfolio-viewer\"")

    private data class Origin(val scheme: String, val host: String, val port: Int) {
        val effectivePort: Int get() = if (port != -1) port else if (scheme == "https") 443 else 80
        override fun toString(): String = if (port == -1) "$scheme://$host" else "$scheme://$host:$port"
    }

    /** Scheme, host and port as a browser reads them: a user name before "@" is dropped, the host lowercased. */
    private fun origin(url: String): Origin? {
        val match = ORIGIN.find(url) ?: return null
        val scheme = match.groupValues[1].lowercase()
        val authority = match.groupValues[2].substringAfterLast('@')
        val host: String
        val portText: String
        if (authority.startsWith("[")) {
            val end = authority.indexOf(']')
            if (end < 0) return null
            host = authority.substring(0, end + 1)
            portText = authority.substring(end + 1).removePrefix(":")
        } else {
            host = authority.substringBefore(':')
            portText = if (':' in authority) authority.substringAfter(':') else ""
        }
        if (host.isEmpty() || host.any { it.isWhitespace() || it == '\\' }) return null
        val port = if (portText.isEmpty()) -1 else portText.toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
        return Origin(scheme, host.lowercase(), port)
    }

    /**
     * The server as `scheme://host[:port]`, or null when the input cannot be a web server.
     * Without a scheme, https is assumed; paths, queries and trailing slashes are dropped.
     */
    fun normalize(input: String): String? {
        val trimmed = input.trim()
        if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return null
        val candidate = when {
            trimmed.contains("://") -> trimmed
            // "javascript:…", "mailto:…": a scheme without "//" is never a server ("host:3310" has digits after the colon)
            SCHEME.containsMatchIn(trimmed) && !HOST_PORT_WITHOUT_SCHEME.containsMatchIn(trimmed) -> return null
            else -> "https://$trimmed"
        }
        val origin = origin(candidate) ?: return null
        if (origin.scheme != "http" && origin.scheme != "https") return null
        return origin.toString()
    }

    /** True when `url` belongs to the server (same scheme, host and port); everything else leaves the app. */
    fun isSameOrigin(url: String, server: String): Boolean {
        val a = origin(url) ?: return false
        val b = origin(server) ?: return false
        if (a.scheme != "http" && a.scheme != "https") return false
        return a.scheme == b.scheme && a.host == b.host && a.effectivePort == b.effectivePort
    }

    /** Phones open the dashboard, TVs open TV mode. */
    fun startUrl(server: String, tv: Boolean): String = server + if (tv) "/tv" else "/"

    /** The server's `/api/health` answer is a JSON object that names the app; any other site is refused. */
    fun isPortfolioViewer(healthJson: String): Boolean {
        val body = healthJson.trim()
        return body.startsWith("{") && body.endsWith("}") && HEALTH_APP.containsMatchIn(body)
    }

    /**
     * The https address to use when an http server redirects its health check to https on the same host
     * (typed `http://portfolio.jbpcapital.de`); null for any other redirect, which is never followed.
     */
    fun httpsUpgrade(server: String, location: String?): String? {
        if (location == null || !HEALTH_ON_HTTPS.containsMatchIn(location)) return null
        val from = origin(server) ?: return null
        val to = origin(location) ?: return null
        return if (from.scheme == "http" && from.host == to.host) to.toString() else null
    }

    private val HEALTH_ON_HTTPS = Regex("^https://[^/?#]+/api/health(?:$|[?#])", RegexOption.IGNORE_CASE)
}
