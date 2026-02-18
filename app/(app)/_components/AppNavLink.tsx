"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentProps, type MouseEvent } from "react";

type AppNavLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
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
  ...props
}: AppNavLinkProps) {
  const pathname = usePathname();
  const shouldUseHardNavigation = shouldForceHardNavigation(pathname, href);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (!shouldUseHardNavigation) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (target && target !== "_self") return;
    event.preventDefault();
    window.location.assign(href);
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
