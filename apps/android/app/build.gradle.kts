plugins {
    id("com.android.application")
}

// Server the first-run screen suggests. The emulator reaches the host computer at 10.0.2.2:
//   gradlew assembleDebug -PdefaultServer=http://10.0.2.2:3310
val defaultServer: String = providers.gradleProperty("defaultServer").orNull ?: "https://portfolio.jbpcapital.de"

// The upload key lives outside the repository; release builds are signed only when it is configured
// in ~/.gradle/gradle.properties (pvUploadStoreFile, pvUploadStorePassword, pvUploadKeyAlias, pvUploadKeyPassword).
val uploadStoreFile: String? = providers.gradleProperty("pvUploadStoreFile").orNull

android {
    namespace = "de.jbpcapital.portfolioviewer"
    compileSdk = 36

    defaultConfig {
        applicationId = "de.jbpcapital.portfolioviewer"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "DEFAULT_SERVER", "\"$defaultServer\"")
    }

    signingConfigs {
        if (uploadStoreFile != null) {
            create("upload") {
                storeFile = file(uploadStoreFile)
                storePassword = providers.gradleProperty("pvUploadStorePassword").get()
                keyAlias = providers.gradleProperty("pvUploadKeyAlias").get()
                keyPassword = providers.gradleProperty("pvUploadKeyPassword").get()
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (uploadStoreFile != null) signingConfig = signingConfigs.getByName("upload")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
