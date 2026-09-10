export default function MarketGlyph({ id }) {
  const common = {
    viewBox: "0 0 48 48",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": "true",
    className: "market-lane-glyph",
  };
  switch (id) {
    case "stocks":
      return (
        <svg {...common}>
          <path
            d="M8 34 L18 24 L26 30 L40 14"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M30 14 H40 V24"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "etfs":
      return (
        <svg {...common}>
          <rect x="8" y="22" width="8" height="16" rx="2" fill="currentColor" opacity="0.35" />
          <rect x="20" y="14" width="8" height="24" rx="2" fill="currentColor" opacity="0.55" />
          <rect x="32" y="8" width="8" height="30" rx="2" fill="currentColor" />
        </svg>
      );
    case "bonds":
      return (
        <svg {...common}>
          <rect
            x="10"
            y="14"
            width="28"
            height="20"
            rx="4"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            d="M16 24 H32"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="18" cy="20" r="1.6" fill="currentColor" />
          <circle cx="30" cy="28" r="1.6" fill="currentColor" />
        </svg>
      );
    case "commodities":
      return (
        <svg {...common}>
          <path
            d="M24 8 L38 16 V32 L24 40 L10 32 V16 Z"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d="M24 8 V40 M10 16 L38 32 M38 16 L10 32"
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.45"
          />
        </svg>
      );
    case "currencies":
      return (
        <svg {...common}>
          <circle cx="24" cy="24" r="14" stroke="currentColor" strokeWidth="3" />
          <path
            d="M28 17 C24 15 18 16 18 22 C18 28 30 24 30 30 C30 35 24 37 19 35"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d="M24 13 V35" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case "realestate":
      return (
        <svg {...common}>
          <path
            d="M8 24 L24 10 L40 24 V38 H8 Z"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d="M20 38 V28 H28 V38"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return null;
  }
}
