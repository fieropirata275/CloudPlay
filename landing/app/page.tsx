import { Business } from "@/components/landing/Business";
import { Consoles } from "@/components/landing/Consoles";
import { DemoForm } from "@/components/landing/DemoForm";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Nav } from "@/components/landing/Nav";
import { Screens } from "@/components/landing/Screens";
import { ScrollStatement } from "@/components/landing/ScrollStatement";
import { SmoothScroll } from "@/components/landing/SmoothScroll";
import { Stats } from "@/components/landing/Stats";

export default function Home() {
  return (
    <SmoothScroll>
      <Nav />
      <main>
        <Hero />
        <ScrollStatement />
        <HowItWorks />
        <Screens />
        <Consoles />
        <Stats />
        <Business />
        <DemoForm />
      </main>
      <Footer />
    </SmoothScroll>
  );
}
