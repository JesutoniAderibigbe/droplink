// Turn errors from Supabase, WebRTC, the File System Access API etc. into
// messages a person can act on. Never include file contents or tokens.

const known: [RegExp, string][] = [
  [/Invalid login credentials/i, 'Wrong email or password.'],
  [
    /User already registered|account_exists_or_unconfirmed/i,
    'That email already has an account. Sign in instead.',
  ],
  [/Password should be at least|weak_password/i, 'Use a longer password (at least 8 characters).'],
  [/Unable to validate email|invalid format/i, 'That email address looks wrong.'],
  [/contact limit reached/i, 'That would go over the limit of 50 people. Remove someone first.'],
  [/too many contact requests/i, 'You have sent a lot of requests. Try again in an hour.'],
  [/too many invites/i, 'You have made a lot of QR codes recently. Try again in a bit.'],
  [/invite_invalid/i, 'That code has expired or was already used. Ask for a new one.'],
  [/invite_own/i, "That's your own code. Open it on the other person's phone."],
  [/Not connected to that contact/i, "Can't reach them right now. Try again in a moment."],
  [/rate_limited/i, 'You have sent a lot of files recently. Please wait a bit and try again.'],
  [
    /quota_exceeded/i,
    "You've used today's 500 MB relay allowance. Open DropLink on the other device to send directly.",
  ],
  [
    /too_large/i,
    'That is too big for the encrypted relay (100 MB max). Open DropLink on the other device to send it directly.',
  ],
  [/too many files/i, 'Too many files in one go. Try sending fewer at a time.'],
  [
    /Email rate limit|over_email_send_rate_limit|only request this after/i,
    'Too many emails requested. Wait a minute and try again.',
  ],
  [
    /Request rate limit|over_request_rate_limit|too many requests/i,
    'Too many attempts. Wait a few minutes and try again.',
  ],
  [
    /Token has expired|otp_expired|invalid.*otp/i,
    'That code is wrong or has expired. Request a new one.',
  ],
  [
    /provider is not enabled|Unsupported provider/i,
    'Google sign-in is not set up on this server yet. Use email instead.',
  ],
  [
    /Failed to fetch|NetworkError|Load failed/i,
    "Can't reach the server. Check your connection and try again.",
  ],
  [/AbortError|The user aborted/i, 'Cancelled.'],
  [/QuotaExceededError/i, 'This device is out of storage space.'],
  [/NotAllowedError/i, 'Permission was denied. You can change this in your browser settings.'],
  [/device is revoked/i, 'This device was removed from your account.'],
];

export function humanError(e: unknown): string {
  const raw =
    e instanceof Error
      ? `${e.name}: ${e.message}`
      : typeof e === 'object' && e && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e);
  for (const [re, msg] of known) if (re.test(raw)) return msg;
  return 'Something went wrong. Please try again.';
}
