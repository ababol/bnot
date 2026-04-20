import { ArrowUpRight } from "lucide-react";
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
      <ArrowUpRight size={16} strokeWidth={1.5} className={styles.icon} />
    </a>
  );
}
