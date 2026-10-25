import { Backstage } from "@/components/landing/Backstage";
import { Business } from "@/components/landing/Business";
import { Consoles } from "@/components/landing/Consoles";
import { Cursor } from "@/components/landing/Cursor";
import { DemoForm } from "@/components/landing/DemoForm";
import { Devices } from "@/components/landing/Devices";
import { Footer } from "@/components/landing/Footer";
import { Gallery } from "@/components/landing/Gallery";
import { Intro } from "@/components/landing/Intro";
import { Manifesto } from "@/components/landing/Manifesto";
import { ScrollProgress } from "@/components/landing/MotionKit";
import { Pipeline } from "@/components/landing/Pipeline";
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
      <Intro />
      <ScrollProgress />
      <Cursor />
      <Nav />
      <main>
        <Hero />
        <Devices />
        <Manifesto />
        <ScrollStatement />
        <HowItWorks />
        <Pipeline />
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
