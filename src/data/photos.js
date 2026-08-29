const u = (id, w = 1600, q = 80) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=${q}`;

export const photos = {
  heroExterior: u('1600585154340-be6161a56a0c', 2000),
  duskExterior: u('1600607687939-ce8a6c25118c', 1600),
  poolVilla: u('1600596542815-ffad4c1539a9', 1200),
  dayExterior: u('1600047509807-ba8f99d2cdde', 1200),
  interiorBright: u('1600210492486-724fe5c67fb0', 1200),
  interiorWarm: u('1600585154526-990dced4db0d', 1200),
  aerialNeighborhood: u('1512917774080-9991f1c4c750', 2000),
  duskInteriorWide: u('1600566753086-00f18fb6b3ea', 2000),
};
