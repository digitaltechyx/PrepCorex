import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/hooks/use-auth";
import { Toaster } from "@/components/ui/toaster";
import { WhatsAppFloatingButton } from "@/components/whatsapp-floating-button";

export const metadata: Metadata = {
  title: "PrepCorex",
  description: "Inventory Management System - Modern inventory management with real-time updates",
  icons: {
    icon: [
      { url: "/PCX%20Testing-11.svg", type: "image/svg+xml" },
    ],
    apple: "/PCX%20Testing-11.svg",
    shortcut: "/PCX%20Testing-11.svg",
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased">
        <AuthProvider>
          {children}
          <Toaster />
          <WhatsAppFloatingButton />
        </AuthProvider>
      </body>
    </html>
  );
}
