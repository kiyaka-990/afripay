// afripay-core/src/lib.rs
// High-performance Rust core: network detection, HMAC signing,
// token management, phone normalization, request validation.
// Compiled to native Node.js addon via Neon bindings.

use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum Network {
    Mpesa,
    MtnMomo,
    AirtelMoney,
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PhoneInfo {
    pub raw: String,
    pub normalized: String,
    pub country_code: String,
    pub country: String,
    pub network: Network,
    pub network_str: String,
    pub is_valid: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MpesaPassword {
    pub password: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiKeyPair {
    pub api_key: String,
    pub api_secret: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebhookSignature {
    pub signature: String,
    pub timestamp: String,
    pub valid: bool,
}

// ─── Network Detection ────────────────────────────────────────────────────────
// Phone prefix → network/country mapping.
// This runs on every inbound request so it MUST be fast — Rust is ~50x
// faster than equivalent JS for this kind of prefix scanning.

pub fn detect_network(phone: &str) -> PhoneInfo {
    let normalized = normalize_phone(phone);

    let rules: Vec<(&str, &str, &str, Network)> = vec![
        // Kenya - Safaricom M-Pesa
        ("25470", "KE", "Kenya", Network::Mpesa),
        ("25471", "KE", "Kenya", Network::Mpesa),
        ("25472", "KE", "Kenya", Network::Mpesa),
        ("25479", "KE", "Kenya", Network::Mpesa),
        // Kenya - Airtel
        ("25473", "KE", "Kenya", Network::AirtelMoney),
        ("25474", "KE", "Kenya", Network::AirtelMoney),
        // Uganda - MTN MoMo
        ("25677", "UG", "Uganda", Network::MtnMomo),
        ("25678", "UG", "Uganda", Network::MtnMomo),
        ("25676", "UG", "Uganda", Network::MtnMomo),
        // Uganda - Airtel
        ("25670", "UG", "Uganda", Network::AirtelMoney),
        ("25675", "UG", "Uganda", Network::AirtelMoney),
        // Ghana - MTN MoMo
        ("23324", "GH", "Ghana", Network::MtnMomo),
        ("23325", "GH", "Ghana", Network::MtnMomo),
        ("23326", "GH", "Ghana", Network::MtnMomo),
        // Ghana - Airtel/Tigo
        ("23327", "GH", "Ghana", Network::AirtelMoney),
        // Tanzania - Airtel
        ("25568", "TZ", "Tanzania", Network::AirtelMoney),
        ("25569", "TZ", "Tanzania", Network::AirtelMoney),
        // Tanzania - Vodacom (M-Pesa TZ)
        ("25574", "TZ", "Tanzania", Network::Mpesa),
        ("25575", "TZ", "Tanzania", Network::Mpesa),
        ("25576", "TZ", "Tanzania", Network::Mpesa),
        // Rwanda - MTN MoMo
        ("25078", "RW", "Rwanda", Network::MtnMomo),
        ("25079", "RW", "Rwanda", Network::MtnMomo),
        // Zambia - MTN MoMo
        ("26076", "ZM", "Zambia", Network::MtnMomo),
        ("26077", "ZM", "Zambia", Network::MtnMomo),
        // Nigeria - Airtel
        ("23480", "NG", "Nigeria", Network::AirtelMoney),
        ("23481", "NG", "Nigeria", Network::AirtelMoney),
    ];

    for (prefix, cc, country, network) in &rules {
        if normalized.starts_with(prefix) {
            let network_str = match network {
                Network::Mpesa => "mpesa",
                Network::MtnMomo => "mtn_momo",
                Network::AirtelMoney => "airtel",
                Network::Unknown => "unknown",
            };
            return PhoneInfo {
                raw: phone.to_string(),
                normalized: normalized.clone(),
                country_code: cc.to_string(),
                country: country.to_string(),
                network: network.clone(),
                network_str: network_str.to_string(),
                is_valid: normalized.len() >= 11 && normalized.len() <= 13,
            };
        }
    }

    PhoneInfo {
        raw: phone.to_string(),
        normalized,
        country_code: "XX".to_string(),
        country: "Unknown".to_string(),
        network: Network::Unknown,
        network_str: "unknown".to_string(),
        is_valid: false,
    }
}

// ─── Phone Normalization ──────────────────────────────────────────────────────

pub fn normalize_phone(phone: &str) -> String {
    // Strip everything except digits
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();

    // Handle leading zeros → strip and add country code
    // e.g. "0712345678" (Kenya local) → "254712345678"
    if digits.starts_with("0") && digits.len() == 10 {
        // Assume Kenya if 10 digits starting with 0
        return format!("254{}", &digits[1..]);
    }

    // Handle + prefix (already stripped above)
    // Handle 7xxxxxxxx (9 digits, Kenya short form)
    if digits.len() == 9 && (digits.starts_with('7') || digits.starts_with('1')) {
        return format!("254{}", digits);
    }

    digits
}

// ─── M-Pesa Password Generator ────────────────────────────────────────────────
// Daraja requires: Base64(shortcode + passkey + timestamp)
// Computing this in Rust is much faster than in JS — matters at scale.

pub fn generate_mpesa_password(shortcode: &str, passkey: &str) -> MpesaPassword {
    let timestamp = Utc::now().format("%Y%m%d%H%M%S").to_string();
    let raw = format!("{}{}{}", shortcode, passkey, timestamp);
    let password = general_purpose::STANDARD.encode(raw.as_bytes());
    MpesaPassword { password, timestamp }
}

// ─── HMAC-SHA256 Webhook Signature ────────────────────────────────────────────
// Sign outgoing webhooks so your customers can verify they came from AfriPay.

pub fn sign_webhook(payload: &str, secret: &str) -> WebhookSignature {
    let timestamp = Utc::now().timestamp().to_string();
    let message = format!("{}.{}", timestamp, payload);

    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC can accept any key size");
    mac.update(message.as_bytes());
    let result = mac.finalize();
    let signature = hex::encode(result.into_bytes());

    WebhookSignature {
        signature: format!("sha256={}", signature),
        timestamp,
        valid: true,
    }
}

pub fn verify_webhook(payload: &str, secret: &str, received_sig: &str, timestamp: &str) -> bool {
    let message = format!("{}.{}", timestamp, payload);
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC can accept any key size");
    mac.update(message.as_bytes());
    let result = mac.finalize();
    let expected = format!("sha256={}", hex::encode(result.into_bytes()));
    expected == received_sig
}

// ─── API Key Generator ────────────────────────────────────────────────────────

pub fn generate_api_keypair() -> ApiKeyPair {
    let api_key = format!("afp_live_{}", Uuid::new_v4().to_string().replace('-', ""));
    let secret_raw = Uuid::new_v4().to_string() + &Uuid::new_v4().to_string();
    let mut hasher = Sha256::new();
    hasher.update(secret_raw.as_bytes());
    let api_secret = format!("afps_{}", hex::encode(hasher.finalize()));

    ApiKeyPair {
        api_key,
        api_secret,
        created_at: Utc::now().to_rfc3339(),
    }
}

// ─── Payment Request Validator ────────────────────────────────────────────────

pub fn validate_payment_request(
    phone: &str,
    amount: f64,
    currency: &str,
    reference: &str,
) -> ValidationResult {
    let mut errors = Vec::new();

    // Phone
    let phone_info = detect_network(phone);
    if !phone_info.is_valid {
        errors.push(format!("Invalid phone number: '{}'", phone));
    }
    if phone_info.network == Network::Unknown {
        errors.push(format!(
            "Unsupported network for phone prefix of '{}'",
            phone
        ));
    }

    // Amount
    if amount <= 0.0 {
        errors.push("Amount must be greater than 0".to_string());
    }
    if amount > 150_000.0 {
        errors.push("Amount exceeds maximum transaction limit of 150,000".to_string());
    }

    // Currency
    let supported_currencies = ["KES", "UGX", "GHS", "TZS", "RWF", "ZMW", "NGN", "USD"];
    if !supported_currencies.contains(&currency) {
        errors.push(format!(
            "Unsupported currency '{}'. Supported: {:?}",
            currency, supported_currencies
        ));
    }

    // Reference
    if reference.is_empty() {
        errors.push("Reference is required".to_string());
    }
    if reference.len() > 20 {
        errors.push("Reference must be 20 characters or less".to_string());
    }

    ValidationResult {
        valid: errors.is_empty(),
        errors,
    }
}

// ─── Rate Limit Key Builder ───────────────────────────────────────────────────
// Build Redis-compatible rate limit keys.

pub fn build_rate_limit_key(api_key: &str, endpoint: &str, window: &str) -> String {
    let ts = Utc::now().timestamp();
    let window_secs: i64 = match window {
        "minute" => 60,
        "hour" => 3600,
        "day" => 86400,
        _ => 60,
    };
    let bucket = ts / window_secs;
    format!("rl:{}:{}:{}", api_key, endpoint, bucket)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_mpesa_kenya() {
        let info = detect_network("+254712345678");
        assert_eq!(info.network, Network::Mpesa);
        assert_eq!(info.country_code, "KE");
        assert!(info.is_valid);
    }

    #[test]
    fn test_detect_mtn_uganda() {
        let info = detect_network("+256771234567");
        assert_eq!(info.network, Network::MtnMomo);
        assert_eq!(info.country_code, "UG");
    }

    #[test]
    fn test_normalize_local_format() {
        let normalized = normalize_phone("0712345678");
        assert_eq!(normalized, "254712345678");
    }

    #[test]
    fn test_validate_good_request() {
        let result = validate_payment_request("+254712345678", 500.0, "KES", "ORDER-123");
        assert!(result.valid);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_validate_bad_amount() {
        let result = validate_payment_request("+254712345678", -10.0, "KES", "ORDER-123");
        assert!(!result.valid);
        assert!(!result.errors.is_empty());
    }

    #[test]
    fn test_webhook_sign_verify() {
        let payload = r#"{"event":"payment.success","amount":1000}"#;
        let secret = "my_webhook_secret_key";
        let sig = sign_webhook(payload, secret);
        assert!(verify_webhook(payload, secret, &sig.signature, &sig.timestamp));
    }

    #[test]
    fn test_api_key_format() {
        let kp = generate_api_keypair();
        assert!(kp.api_key.starts_with("afp_live_"));
        assert!(kp.api_secret.starts_with("afps_"));
    }

    #[test]
    fn test_mpesa_password_base64() {
        let pw = generate_mpesa_password("174379", "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919");
        assert!(!pw.password.is_empty());
        assert_eq!(pw.timestamp.len(), 14);
    }
}
