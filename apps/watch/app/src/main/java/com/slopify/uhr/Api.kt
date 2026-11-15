package com.slopify.uhr

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.NumberFormat
import java.util.Locale

/** Eine Bestellung, wie die Uhr sie zeigt (aus GET /admin/v1/orders). */
data class Order(
    val id: String,
    val number: String,
    val customer: String,
    val totalCents: Long,
    val itemCount: Int,
    val status: String,
    val paymentStatus: String,
    val placedAt: String,
)

/** Ergebnis des Kopplungscodes (POST /auth/v1/device-pairings/claim). */
data class Pairing(val token: String, val shopId: String, val shopName: String)

class ApiException(val status: Int, message: String) : Exception(message)

/** Liest die Liste aus der Antwort der Admin-API. */
fun parseOrders(json: String): List<Order> {
    val data = JSONObject(json).getJSONArray("data")
    return (0 until data.length()).map { i ->
        val o = data.getJSONObject(i)
        Order(
            id = o.getString("id"),
            number = o.getString("orderNumber"),
            customer = o.optString("customerName").ifBlank { o.optString("email") },
            totalCents = o.optLong("total"),
            itemCount = o.optInt("itemCount"),
            status = o.optString("status"),
            paymentStatus = o.optString("paymentStatus"),
            placedAt = o.optString("placedAt"),
        )
    }
}

fun parsePairing(json: String): Pairing {
    val o = JSONObject(json)
    return Pairing(o.getString("token"), o.getString("shopId"), o.optString("shopName", "Shop"))
}

/** Bestellungen, die neuer sind als die zuletzt gesehene (IDs sind UUIDv7, also zeitlich sortiert). */
fun newerThan(orders: List<Order>, lastSeenId: String?): List<Order> =
    if (lastSeenId == null) emptyList() else orders.filter { it.id > lastSeenId }

fun euro(cents: Long): String = NumberFormat.getCurrencyInstance(Locale.GERMANY).format(cents / 100.0)

/** Stand in Worten wie im Backoffice. */
fun stateText(o: Order): String = when {
    o.status == "cancelled" -> "Storniert"
    o.status == "pending_payment" -> "Wartet auf Zahlung"
    o.status == "completed" -> "Versendet"
    else -> "Zu versenden"
}

/** Kleiner Zugang zur Slopify-API (ohne Bibliothek). */
class Api(private val base: String = BuildConfig.API_BASE) {

    fun claim(code: String): Pairing {
        val body = JSONObject().put("code", code).toString()
        return parsePairing(request("POST", "/auth/v1/device-pairings/claim", body, emptyMap()))
    }

    fun orders(token: String, shopId: String, limit: Int = 15): List<Order> =
        parseOrders(
            request(
                "GET",
                "/admin/v1/orders?limit=$limit",
                null,
                mapOf("Authorization" to "Bearer $token", "Shop-Id" to shopId),
            ),
        )

    private fun request(method: String, path: String, body: String?, headers: Map<String, String>): String {
        val c = URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 15_000
            c.readTimeout = 20_000
            c.setRequestProperty("Accept", "application/json")
            c.setRequestProperty("Accept-Language", "de")
            headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toByteArray()) }
            }
            val status = c.responseCode
            val text = (if (status in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (status !in 200..299) {
                val detail = runCatching { JSONObject(text).optString("detail") }.getOrNull()
                throw ApiException(status, detail?.ifBlank { null } ?: "Fehler $status")
            }
            return text
        } finally {
            c.disconnect()
        }
    }
}
