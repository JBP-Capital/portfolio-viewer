package de.jbpcapital.portfolioviewer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerAddressTest {

    @Test
    fun `adds https and keeps only scheme, host and port`() {
        assertEquals("https://portfolio.example.com", ServerAddress.normalize("portfolio.example.com/"))
        assertEquals("https://portfolio.example.com", ServerAddress.normalize("  Portfolio.Example.com  "))
        assertEquals("http://192.168.1.5:3310", ServerAddress.normalize("http://192.168.1.5:3310/p/abc?x=1"))
        assertEquals("https://portfolio.jbpcapital.de", ServerAddress.normalize("HTTPS://portfolio.jbpcapital.de/"))
    }

    @Test
    fun `refuses what cannot be a web server`() {
        assertNull(ServerAddress.normalize(""))
        assertNull(ServerAddress.normalize("http://"))
        assertNull(ServerAddress.normalize("ftp://example.com"))
        assertNull(ServerAddress.normalize("javascript:alert(1)"))
        assertNull(ServerAddress.normalize("exa mple.com"))
    }

    @Test
    fun `keeps only the server's own pages inside the app`() {
        val server = "https://portfolio.example.com"
        assertTrue(ServerAddress.isSameOrigin("https://portfolio.example.com/p/1", server))
        assertTrue(ServerAddress.isSameOrigin("https://PORTFOLIO.example.com/", server))
        assertFalse(ServerAddress.isSameOrigin("http://portfolio.example.com/", server))
        assertFalse(ServerAddress.isSameOrigin("https://portfolio.example.com:8443/", server))
        assertFalse(ServerAddress.isSameOrigin("https://jbpcapital.de/", server))
        assertFalse(ServerAddress.isSameOrigin("javascript:alert(1)", server))
        assertFalse(ServerAddress.isSameOrigin("file:///etc/hosts", server))
        assertTrue(ServerAddress.isSameOrigin("http://10.0.2.2:3310/tv", "http://10.0.2.2:3310"))
    }

    @Test
    fun `opens the dashboard on phones and TV mode on TVs`() {
        assertEquals("https://portfolio.example.com/", ServerAddress.startUrl("https://portfolio.example.com", tv = false))
        assertEquals("https://portfolio.example.com/tv", ServerAddress.startUrl("https://portfolio.example.com", tv = true))
    }

    @Test
    fun `recognizes a Portfolio Viewer server by its health answer`() {
        assertTrue(ServerAddress.isPortfolioViewer("""{"app":"portfolio-viewer","version":"0.1.0","database":"ok"}"""))
        assertTrue(ServerAddress.isPortfolioViewer("""{ "version": "1", "app" : "portfolio-viewer" }"""))
        assertFalse(ServerAddress.isPortfolioViewer("""{"app":"something-else"}"""))
        assertFalse(ServerAddress.isPortfolioViewer("<html>login</html>"))
        assertFalse(ServerAddress.isPortfolioViewer(""))
    }

    @Test
    fun `accepts host names that java net URI refuses`() {
        assertEquals("https://my_server.lan", ServerAddress.normalize("my_server.lan"))
        assertEquals("https://portfolio.müller.de", ServerAddress.normalize("portfolio.Müller.de/"))
        assertEquals("http://[fd00::5]:3310", ServerAddress.normalize("http://[fd00::5]:3310/tv"))
        assertNull(ServerAddress.normalize("http://example.com:99999"))
    }

    @Test
    fun `takes the host after a user name, as browsers do`() {
        assertEquals("https://evil.com", ServerAddress.normalize("https://portfolio.jbpcapital.de@evil.com"))
    }

    @Test
    fun `keeps same-origin links with characters that java net URI refuses inside the app`() {
        val server = "https://portfolio.example.com"
        assertTrue(ServerAddress.isSameOrigin("https://portfolio.example.com/p/1?range=a|b", server))
        assertTrue(ServerAddress.isSameOrigin("https://portfolio.example.com/search?q={x}%", server))
        assertFalse(ServerAddress.isSameOrigin("https://portfolio.example.com@evil.com/", server))
    }

    @Test
    fun `accepts only a JSON health answer`() {
        assertFalse(ServerAddress.isPortfolioViewer("<html><pre>{\"app\":\"portfolio-viewer\"}</pre></html>"))
        assertTrue(ServerAddress.isPortfolioViewer("  {\"app\":\"portfolio-viewer\"}\n"))
    }

    @Test
    fun `follows only a redirect from http to https on the same host`() {
        assertEquals(
            "https://portfolio.jbpcapital.de",
            ServerAddress.httpsUpgrade("http://portfolio.jbpcapital.de", "https://portfolio.jbpcapital.de/api/health"),
        )
        assertNull(ServerAddress.httpsUpgrade("http://portfolio.jbpcapital.de", "https://evil.com/api/health"))
        assertNull(ServerAddress.httpsUpgrade("http://portfolio.jbpcapital.de", "http://portfolio.jbpcapital.de/other"))
        assertNull(ServerAddress.httpsUpgrade("https://portfolio.jbpcapital.de", "https://portfolio.jbpcapital.de/api/health"))
        assertNull(ServerAddress.httpsUpgrade("http://portfolio.jbpcapital.de", null))
    }
}
