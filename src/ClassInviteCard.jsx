import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { inviteUrlForCode } from "./classStore";

/**
 * Per-class invite QR (derived from the class invite code) + copy link.
 */
export default function ClassInviteCard({
  inviteCode,
  onCopy,
  copied = false,
  compact = false,
}) {
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    if (!inviteCode) {
      setQrUrl("");
      return;
    }
    let cancelled = false;
    const link = inviteUrlForCode(inviteCode);
    QRCode.toDataURL(link, {
      width: compact ? 148 : 180,
      margin: 1,
      errorCorrectionLevel: "M",
      color: {
        dark: "#0f4c5c",
        light: "#ffffff",
      },
    })
      .then((url) => {
        if (!cancelled) setQrUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [inviteCode, compact]);

  return (
    <div className={`invite-card${compact ? " invite-card-compact" : ""}`}>
      <div className="invite-qr-block">
        <div className="invite-qr-wrap">
          {qrUrl ? (
            <img
              className="invite-qr"
              src={qrUrl}
              alt={`QR code to join class ${inviteCode}`}
              width={compact ? 148 : 180}
              height={compact ? 148 : 180}
            />
          ) : (
            <div
              className={`invite-qr invite-qr-placeholder${compact ? " is-compact" : ""}`}
              aria-hidden="true"
            />
          )}
        </div>
        <p className="invite-scan-label">Scan this to join the class!</p>
      </div>
      <button
        type="button"
        className="primary-btn invite-copy-btn"
        data-click="confirm"
        onClick={onCopy}
        disabled={!inviteCode}
      >
        {copied ? "Copied!" : "Copy invite link"}
      </button>
    </div>
  );
}
