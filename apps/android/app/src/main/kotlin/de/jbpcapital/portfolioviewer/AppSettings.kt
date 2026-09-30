package de.jbpcapital.portfolioviewer

import android.content.Context

/** The chosen server, kept on the device. */
object AppSettings {
    private const val FILE = "settings"
    private const val SERVER = "server"

    fun server(context: Context): String? = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(SERVER, null)

    fun setServer(context: Context, server: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(SERVER, server).apply()
    }
}
