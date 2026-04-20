import type { AnchorHTMLAttributes, ReactNode } from "react";
import styles from "./external-link.module.css";

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
};

export function ExternalLink({ children, className, ...rest }: Props) {
  return (
    <a
      {...rest}
      className={[styles.link, className ?? ""].join(" ").trim()}
      target={rest.target ?? "_blank"}
      rel={rest.rel ?? "noreferrer"}
    >
      <span className={styles.label}>{children}</span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 16 16"
        width="16"
        height="16"
        aria-hidden="true"
        className={styles.icon}
      >
        <path
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M6.25 3.75h6m0 0v6m0-6-8.5 8.5"
        />
      </svg>
    </a>
  );
}
