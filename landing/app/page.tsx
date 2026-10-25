import { Backstage } from "@/components/landing/Backstage";
import { Business } from "@/components/landing/Business";
import { Consoles } from "@/components/landing/Consoles";
import { Cursor } from "@/components/landing/Cursor";
import { DemoForm } from "@/components/landing/DemoForm";
import { Devices } from "@/components/landing/Devices";
import { Footer } from "@/components/landing/Footer";
import { Gallery } from "@/components/landing/Gallery";
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
      <Cursor />
      <Nav />
      <main>
        <Hero />
        <Devices />
        <ScrollStatement />
        <HowItWorks />
        <Screens />
        <Gallery />
        <Consoles />
        <Backstage />
        <Stats />
        <Business />
        <DemoForm />
      </main>
      <Footer />
    </SmoothScroll>
  );
}
