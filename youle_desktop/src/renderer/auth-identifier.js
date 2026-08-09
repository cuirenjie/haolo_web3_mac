const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAINLAND_PHONE_PATTERN = /^1[3-9]\d{9}$/;

export function normalizePhoneIdentifier(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("86")) {
    digits = digits.slice(2);
  }
  return digits;
}

export function normalizeAuthIdentifier(value, channel) {
  if (channel === "email") {
    const email = String(value || "").trim().toLowerCase();
    return EMAIL_PATTERN.test(email) ? email : "";
  }
  if (channel === "sms") {
    const phone = normalizePhoneIdentifier(value);
    return MAINLAND_PHONE_PATTERN.test(phone) ? phone : "";
  }
  return "";
}

export function detectAuthIdentifier(value) {
  const email = normalizeAuthIdentifier(value, "email");
  if (email) return { channel: "email", identifier: email };
  const phone = normalizeAuthIdentifier(value, "sms");
  if (phone) return { channel: "sms", identifier: phone };
  return null;
}

export function oppositeAuthChannel(channel) {
  if (channel === "email") return "sms";
  if (channel === "sms") return "email";
  return null;
}

export function authChannelLabel(channel) {
  return channel === "sms" ? "手机号" : "邮箱";
}

export function maskAuthIdentifier(channel, identifier) {
  if (channel === "sms") {
    const phone = normalizePhoneIdentifier(identifier);
    return phone.length >= 8 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
  }
  const email = String(identifier || "").trim().toLowerCase();
  const parts = email.split("@");
  if (parts.length !== 2) return email;
  const name = parts[0];
  const masked = name.length <= 2 ? `${name.charAt(0)}*` : `${name.slice(0, 2)}***${name.slice(-1)}`;
  return `${masked}@${parts[1]}`;
}
