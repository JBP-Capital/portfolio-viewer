package de.jbpcapital.portfolioviewer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineStateTest {

    @Test
    fun `waits longer after every failed attempt, at most two minutes`() {
        val state = OfflineState()
        val waits = (1..5).map {
            state.onLoadStarted()
            val seconds = state.onFailure()
            // WebView also reports the failed page as finished; that must not reset the count.
            assertFalse(state.onServerPageFinished())
            seconds
        }
        assertEquals(listOf(15, 30, 60, 120, 120), waits)
    }

    @Test
    fun `a page of the server after an outage ends it and asks to clear the history`() {
        val state = OfflineState()
        state.onLoadStarted()
        state.onFailure()
        state.onLoadStarted()
        assertTrue(state.onServerPageFinished())
        assertFalse(state.offline)
        state.onLoadStarted()
        assertEquals(15, state.onFailure())
    }

    @Test
    fun `a normal page load needs no history cleanup`() {
        val state = OfflineState()
        state.onLoadStarted()
        assertFalse(state.onServerPageFinished())
    }

    @Test
    fun `Back leaves the app on the TV and while offline, otherwise goes back in the page`() {
        val state = OfflineState()
        assertFalse(state.backLeavesApp(isTv = false, canGoBack = true))
        assertTrue(state.backLeavesApp(isTv = false, canGoBack = false))
        assertTrue(state.backLeavesApp(isTv = true, canGoBack = true))
        state.onLoadStarted()
        state.onFailure()
        assertTrue(state.backLeavesApp(isTv = false, canGoBack = true))
    }
}
