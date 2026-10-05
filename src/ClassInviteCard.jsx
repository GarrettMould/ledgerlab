import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { inviteUrlForCode } from "./classStore";

const QR_SIZES = {
  compact: 160,
  default: 200,
  board: 360,
};

/**
 * Per-class invite: QR + join code (the `join=` value in the invite URL) + copy actions.
 * size="board" is the projector-friendly classroom layout.
 */
export default function ClassInviteCard({
  inviteCode,
  className = "",
  onCopyLink,
  onCopyCode,
  linkCopied = false,
  codeCopied = false,
  compact = false,
  size = "default",
}) {
  const layout = compact ? "compact" : size === "board" ? "board" : "default";
  const qrSize = QR_SIZES[layout] || QR_SIZES.default;
  const [qrUrl, setQrUrl] = useState("");
  const link = inviteCode ? inviteUrlForCode(inviteCode) : "";

  useEffect(() => {
    if (!inviteCode) {
      setQrUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(link, {
      width: qrSize,
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
  }, [inviteCode, qrSize, link]);

  return (
    <div className={`invite-card invite-card-${layout}`}>
      <div className="invite-qr-block">
        <div className="invite-qr-wrap">
          {qrUrl ? (
            <img
              className="invite-qr"
              src={qrUrl}
              alt={`QR code to join class ${inviteCode}`}
              width={qrSize}
              height={qrSize}
            />
          ) : (
            <div
              className={`invite-qr invite-qr-placeholder is-${layout}`}
              aria-hidden="true"
            />
          )}
        </div>
        <p className="invite-scan-label">Scan with a phone camera</p>
      </div>

      <div className="invite-code-block">
        {className ? (
          <p className="invite-class-name">{className}</p>
        ) : null}
        <p className="invite-code-kicker">Join code</p>
        <p className="invite-code" aria-label={`Join code ${inviteCode || ""}`}>
          {inviteCode || "········"}
        </p>
        <p className="invite-code-hint">
          Students enter this on the home page, or open the invite link.
        </p>
        {link ? (
          <p className="invite-link-preview" title={link}>
            {link}
          </p>
        ) : null}
        <div className="invite-actions">
          <button
            type="button"
            className="primary-btn invite-copy-btn"
            data-click="confirm"
            onClick={onCopyCode}
            disabled={!inviteCode}
          >
            {codeCopied ? "Code copied!" : "Copy join code"}
          </button>
          <button
            type="button"
            className="ghost-btn invite-copy-link-btn"
            data-click="confirm"
            onClick={onCopyLink}
            disabled={!inviteCode}
          >
            {linkCopied ? "Link copied!" : "Copy invite link"}
          </button>
        </div>
      </div>
    </div>
  );
}
