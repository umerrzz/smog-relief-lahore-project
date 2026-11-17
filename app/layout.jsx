import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Smog Relief Fund",
  description: "Parametric income protection for Lahore's outdoor workers. Sepolia testnet proof of concept.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
