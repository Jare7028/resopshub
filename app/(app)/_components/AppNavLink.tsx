"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentProps, type MouseEvent } from "react";

const STALLED_NAV_FALLBACK_MS = 2200;

type AppNavLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  forceHardNavigation?: boolean;
  closeMobileSidebarOnClick?: boolean;
};

function shouldForceHardNavigation(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (!href.startsWith("/")) return false;
  const isEmployeeInfoRoute =
    pathname === "/employee-info" || pathname.startsWith("/employee-info/");
  if (!isEmployeeInfoRoute) return false;
  const isEmployeeInfoTarget = href === "/employee-info" || href.startsWith("/employee-info/");
  return !isEmployeeInfoTarget;
}

export default function AppNavLink({
  href,
  onClick,
  target,
  prefetch,
  forceHardNavigation = false,
  closeMobileSidebarOnClick = false,
  ...props
}: AppNavLinkProps) {
  const pathname = usePathname();
  const shouldUseHardNavigation =
    forceHardNavigation || shouldForceHardNavigation(pathname, href);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (target && target !== "_self") return;

    const nextUrl = new URL(href, window.location.href);
    if (nextUrl.origin !== window.location.origin) {
      return;
    }
    if (
      nextUrl.pathname === window.location.pathname &&
      nextUrl.search === window.location.search
    ) {
      return;
    }

    if (closeMobileSidebarOnClick) {
      const sidebarToggle = document.getElementById(
        "app-sidebar-open"
      ) as HTMLInputElement | null;
      if (sidebarToggle) {
        sidebarToggle.checked = false;
      }
    }

    if (shouldUseHardNavigation) {
      event.preventDefault();
      window.location.assign(nextUrl.toString());
      return;
    }

    const originPathAndSearch = `${window.location.pathname}${window.location.search}`;
    window.setTimeout(() => {
      const currentPathAndSearch = `${window.location.pathname}${window.location.search}`;
      if (currentPathAndSearch !== originPathAndSearch) {
        return;
      }
      window.location.assign(nextUrl.toString());
    }, STALLED_NAV_FALLBACK_MS);
  };

  return (
    <Link
      href={href}
      onClick={handleClick}
      target={target}
      prefetch={shouldUseHardNavigation ? false : prefetch}
      {...props}
    />
  );
}
