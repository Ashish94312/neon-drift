// Saira variable (width + weight axes), latin subset only. Imported as URLs so the single-file build
// inlines them; the game works offline inside the Streamlit iframe.
import normalUrl from "@fontsource-variable/saira/files/saira-latin-wdth-normal.woff2?url";
import italicUrl from "@fontsource-variable/saira/files/saira-latin-wdth-italic.woff2?url";

export async function loadFonts(): Promise<void> {
  const descriptors = { weight: "100 900", stretch: "50% 125%" };
  const faces = [
    new FontFace("Saira", `url(${normalUrl}) format("woff2")`, { ...descriptors, style: "normal" }),
    new FontFace("Saira", `url(${italicUrl}) format("woff2")`, { ...descriptors, style: "italic" }),
  ];
  try {
    await Promise.all(faces.map((f) => f.load()));
    faces.forEach((f) => document.fonts.add(f));
  } catch {
    // Fall back to the system sans in the font stack.
  }
}
