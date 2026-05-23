/** Mesmo ID que em `index.html` (gtag.js). */
const GA_MEASUREMENT_ID = 'G-JBHPLPLLDG';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function isSensitiveAnalyticsPath(path: string): boolean {
  return (
    path.startsWith('/login') ||
    path.startsWith('/registro') ||
    path.startsWith('/verificar-email') ||
    path.startsWith('/redefinir-senha')
  );
}

export function initAnalytics(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const path = (window.location.pathname || '/').toLowerCase();
  if (isSensitiveAnalyticsPath(path)) return;
  if (typeof window.gtag === 'function') return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = (...args: unknown[]) => {
    window.dataLayer?.push(args);
  };
  window.gtag('js', new Date());

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.gtag('config', GA_MEASUREMENT_ID);
}

export function trackSpaPageView(pagePath: string, pageTitle?: string): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  const path = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
  if (isSensitiveAnalyticsPath(path)) return;
  window.gtag('config', GA_MEASUREMENT_ID, {
    page_path: path,
    page_title: pageTitle || path
  });
}
