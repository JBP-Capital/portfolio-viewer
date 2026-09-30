package de.jbpcapital.portfolioviewer

import android.os.Build
import android.view.View
import android.view.WindowInsets

/**
 * Android 15+ draws every app edge to edge. This keeps the view's content clear of the status bar,
 * the navigation bar, display cutouts and the on-screen keyboard.
 */
fun View.padForSystemBars() {
    setOnApplyWindowInsetsListener { view, insets ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
        } else {
            @Suppress("DEPRECATION")
            view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
        }
        insets
    }
}
