import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { HowItWorks } from "./sections/HowItWorks";
import { Features } from "./sections/Features";
import { Evidence } from "./sections/Evidence";
import { Agents } from "./sections/Agents";
import { GetStarted } from "./sections/GetStarted";
import { Footer } from "./sections/Footer";

export default function App() {
  return (
    <div className="page">
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <Evidence />
        <Agents />
        <GetStarted />
      </main>
      <Footer />
    </div>
  );
}
