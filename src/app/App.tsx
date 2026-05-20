import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Hero } from "./components/Hero";
import { Features } from "./components/Features";
import { HowItWorks } from "./components/HowItWorks";
import { Benefits } from "./components/Benefits";
import { Technology } from "./components/Technology";
import { CTA } from "./components/CTA";
import { Footer } from "./components/Footer";
import { Navbar } from "./components/Navbar";
import ContactFormPage from "./pages/ContactFormPage";
import DemoVideo from "./pages/DemoVideo";
import { OnlineKaryotyping } from "./pages/OnlineKaryotyping";

function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <Hero />
      <Features />
      <HowItWorks />
      <Benefits />
      <Technology />
      <CTA />
      <Footer />
    </div>
  );
}

function Layout() {
  const location = useLocation();

  // hide navbar only for /online-karyotyping
  const hideNavbar = location.pathname === "/online-karyotyping";

  return (
    <>
      {!hideNavbar && <Navbar />}

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/demo" element={<ContactFormPage />} />
        <Route path="/video" element={<DemoVideo />} />
        <Route path="/online-karyotyping" element={<OnlineKaryotyping />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}