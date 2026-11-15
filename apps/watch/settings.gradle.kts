pluginManagement {
    repositories {
        google()
        // Maven Central unter zwei Adressen (manche Netze lassen nur repo1 durch).
        maven("https://repo1.maven.org/maven2")
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        maven("https://repo1.maven.org/maven2")
        mavenCentral()
    }
}
rootProject.name = "slopify-uhr"
include(":app")
