"use client";

import { motion, MotionValue, useScroll, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Cuatro columnas de imágenes que se desplazan a velocidades distintas.
 * CloudPlay: imágenes y estilos por props; usa el Lenis de la raíz en vez de crear otro. */
const ParallaxGallery = ({
  images,
  className,
  imageClassName,
}: {
  images: { src: string; alt: string }[];
  className?: string;
  imageClassName?: string;
}) => {
  const gallery = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  const { scrollYProgress } = useScroll({
    target: gallery,
    offset: ["start end", "end start"],
  });

  const y = useTransform(scrollYProgress, [0, 1], [0, height * 2]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, height * 3.3]);
  const y3 = useTransform(scrollYProgress, [0, 1], [0, height * 1.25]);
  const y4 = useTransform(scrollYProgress, [0, 1], [0, height * 3]);

  useEffect(() => {
    const resize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", resize);
    resize();
    return () => window.removeEventListener("resize", resize);
  }, []);

  const pick = (start: number) => [0, 1, 2].map((k) => images[(start + k) % images.length]);

  return (
    <div
      ref={gallery}
      className={cn("relative box-border flex h-[175vh] gap-[2vw] overflow-hidden p-[2vw]", className)}
    >
      <Column images={pick(0)} y={y} imageClassName={imageClassName} />
      <Column images={pick(3)} y={y2} imageClassName={imageClassName} />
      <Column images={pick(6)} y={y3} imageClassName={imageClassName} />
      <Column images={pick(9)} y={y4} imageClassName={imageClassName} />
    </div>
  );
};

type ColumnProps = {
  images: { src: string; alt: string }[];
  y: MotionValue<number>;
  imageClassName?: string;
};

const Column = ({ images, y, imageClassName }: ColumnProps) => {
  return (
    <motion.div
      className="relative -top-[45%] flex h-full w-1/4 min-w-0 flex-col gap-[2vw] first:top-[-45%] [&:nth-child(2)]:top-[-95%] [&:nth-child(3)]:top-[-45%] [&:nth-child(4)]:top-[-75%]"
      style={{ y }}
    >
      {images.map((img, i) => (
        <div key={i} className={cn("relative h-full w-full overflow-hidden", imageClassName)}>
          <img src={img.src} alt={img.alt} loading="lazy" className="pointer-events-none h-full w-full object-cover" />
        </div>
      ))}
    </motion.div>
  );
};

export { ParallaxGallery };

