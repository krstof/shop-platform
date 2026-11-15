package com.slopify.uhr

import android.content.Context

/** Verbindung zum Shop und zuletzt gesehene Bestellung, im privaten Speicher der App. */
class Store(context: Context) {
    private val prefs = context.getSharedPreferences("slopify", Context.MODE_PRIVATE)

    val pairing: Pairing?
        get() {
            val token = prefs.getString("token", null) ?: return null
            val shopId = prefs.getString("shopId", null) ?: return null
            return Pairing(token, shopId, prefs.getString("shopName", "Shop") ?: "Shop")
        }

    fun save(p: Pairing) {
        prefs.edit().putString("token", p.token).putString("shopId", p.shopId).putString("shopName", p.shopName)
            .remove("lastSeen").apply()
    }

    fun clear() = prefs.edit().clear().apply()

    var lastSeenId: String?
        get() = prefs.getString("lastSeen", null)
        set(v) = prefs.edit().putString("lastSeen", v).apply()
}
