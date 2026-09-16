/**
 * The clickable email in a pinned card.
 *
 * On the console this opens the customer modal from CustomerCard.tsx. That
 * modal wants a live `/api/admin/customer/:email`, which this sandbox does not
 * have and should not pretend to, so here the same click goes to the sandbox's
 * own customer card page. Same affordance, same hover underline, no request.
 */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { MAP as T } from "./mapTheme";

export function CustomerName({
  email,
  children,
  style,
  title,
}: {
  email: string | null | undefined;
  children?: ReactNode;
  style?: CSSProperties;
  title?: string;
}) {
  const [hover, setHover] = useState(false);
  if (!email) return <>{children ?? "·"}</>;
  return (
    <Link
      to="/customer-card"
      title={title ?? `Open customer card · ${email}`}
      onClick={(ev) => ev.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: "pointer",
        textDecoration: hover ? "underline" : "none",
        textDecorationColor: T.cyan,
        textUnderlineOffset: 3,
        color: hover ? T.cyan : T.text,
        transition: "color 0.12s",
        ...style,
      }}
    >
      {children ?? email}
    </Link>
  );
}

export default CustomerName;
