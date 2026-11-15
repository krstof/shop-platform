package com.slopify.uhr

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.TitleCard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val Violet = Color(0xFF7C3AED)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Notifier.ensureChannel(this)
        if (Store(this).pairing != null) OrderWorker.schedule(this)
        setContent {
            MaterialTheme(colors = Colors(primary = Violet, onPrimary = Color.White)) { App() }
        }
    }
}

@Composable
private fun App() {
    val context = LocalContext.current
    val store = remember { Store(context) }
    var pairing by remember { mutableStateOf(store.pairing) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) { ask.launch(Manifest.permission.POST_NOTIFICATIONS) }
    val p = pairing
    if (p == null) {
        PairingScreen(onPaired = {
            store.save(it)
            OrderWorker.schedule(context)
            pairing = it
        })
    } else {
        OrdersScreen(p, onDisconnect = {
            OrderWorker.cancel(context)
            store.clear()
            pairing = null
        })
    }
}

@Composable
private fun PairingScreen(onPaired: (Pairing) -> Unit) {
    val scope = rememberCoroutineScope()
    val list = rememberScalingLazyListState()
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun press(key: String) {
        error = null
        code = when (key) {
            "⌫" -> code.dropLast(1)
            else -> if (code.length < 8) code + key else code
        }
    }

    fun connect() {
        busy = true
        scope.launch {
            try {
                val p = withContext(Dispatchers.IO) { Api().claim(code) }
                onPaired(p)
            } catch (e: ApiException) {
                error = e.message
                code = ""
            } catch (e: Exception) {
                error = "Keine Verbindung. Ist die Uhr im Internet?"
            } finally {
                busy = false
            }
        }
    }

    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(scalingLazyListState = list) }) {
        ScalingLazyColumn(state = list, horizontalAlignment = Alignment.CenterHorizontally) {
            item { ListHeader { Text("Mit Shop verbinden") } }
            item {
                Text(
                    "Code aus dem Backoffice: Einstellungen → Uhr",
                    style = MaterialTheme.typography.caption2,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 12.dp),
                )
            }
            item {
                val shown = code.padEnd(8, '·')
                Text(
                    "${shown.take(4)} ${shown.drop(4)}",
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Medium,
                    letterSpacing = 2.sp,
                    modifier = Modifier.padding(vertical = 6.dp),
                )
            }
            error?.let { msg ->
                item { Text(msg, color = Color(0xFFFCA5A5), style = MaterialTheme.typography.caption2, textAlign = TextAlign.Center) }
            }
            for (row in listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("⌫", "0", "✓"))) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (key in row) {
                            val done = key == "✓"
                            Button(
                                onClick = { if (done) connect() else press(key) },
                                enabled = !busy && (!done || code.length == 8),
                                colors = if (done) ButtonDefaults.primaryButtonColors() else ButtonDefaults.secondaryButtonColors(),
                                modifier = Modifier.size(ButtonDefaults.SmallButtonSize),
                            ) { Text(if (done && busy) "…" else key, fontSize = 18.sp) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OrdersScreen(pairing: Pairing, onDisconnect: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val list = rememberScalingLazyListState()
    var orders by remember { mutableStateOf<List<Order>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }

    fun load() {
        loading = true
        scope.launch {
            try {
                orders = withContext(Dispatchers.IO) { Api().orders(pairing.token, pairing.shopId) }
                error = null
                withContext(Dispatchers.IO) { OrderWorker.check(context) }
            } catch (e: ApiException) {
                error = if (e.status == 401) "Verbindung beendet. Bitte neu verbinden." else e.message
            } catch (e: Exception) {
                error = "Keine Verbindung."
            } finally {
                loading = false
            }
        }
    }
    LaunchedEffect(Unit) { load() }

    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(scalingLazyListState = list) }) {
        ScalingLazyColumn(state = list, modifier = Modifier.fillMaxWidth()) {
            item { ListHeader { Text(pairing.shopName) } }
            error?.let { msg ->
                item { Text(msg, color = Color(0xFFFCA5A5), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
            }
            val shown = orders
            if (shown == null && error == null) item { Text("Lädt …", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) }
            if (shown != null && shown.isEmpty()) {
                item { Text("Noch keine Bestellungen.", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) }
            }
            items(shown ?: emptyList()) { o ->
                TitleCard(
                    onClick = {},
                    title = { Text("Nr. ${o.number}") },
                    time = { Text(euro(o.totalCents)) },
                ) {
                    Text(o.customer, maxLines = 1)
                    Text("${o.itemCount} Artikel · ${stateText(o)}", style = MaterialTheme.typography.caption2)
                }
            }
            item {
                Chip(
                    onClick = { load() },
                    enabled = !loading,
                    label = { Text(if (loading) "Lädt …" else "Aktualisieren") },
                    colors = ChipDefaults.primaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Chip(
                    onClick = onDisconnect,
                    label = { Text("Verbindung trennen") },
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
