// Slopify Uhr (15.11.2026): zeigt neue Bestellungen auf einer Wear-OS-Uhr (Galaxy Watch 4 und neuer).
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Adresse der API; Standard ist der Testserver. Ändern mit -PapiBase=https://…
val apiBase: String = (project.findProperty("apiBase") as String?) ?: "https://api.130-61-18-46.sslip.io"
// Versionsnummer aus der CI (Laufnummer), lokal 1.
val buildNumber: Int = ((project.findProperty("buildNumber") as String?) ?: "1").toInt()

android {
    namespace = "com.slopify.uhr"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.slopify.uhr"
        minSdk = 30
        targetSdk = 35
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
        buildConfigField("String", "API_BASE", "\"$apiBase\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Offen (pausiert 15.11.2026): fester Test-Schlüssel zum Signieren, damit spätere
            // Fassungen sich über die alte installieren lassen. Bis dahin Debug-Schlüssel.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.wear.compose:compose-material:1.4.0")
    implementation("androidx.wear.compose:compose-foundation:1.4.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
