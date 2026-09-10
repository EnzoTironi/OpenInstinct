/** Docker/Fly image builds only — set OPEN_INSTINCT_LOW_MEM_BUILD=1 in Dockerfile. */
export const openInstinctLowMemBuild =
  process.env.OPEN_INSTINCT_LOW_MEM_BUILD === "1";
