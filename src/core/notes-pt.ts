/**
 * Notas e acordes em português (exibição). As fontes publicam em inglês (às vezes em espanhol ou francês);
 * o dado guardado fica como veio, e aqui só se traduz o que tem tradução consagrada. O resto aparece como está.
 */

const NOTES: Record<string, string> = {
  bergamot: 'Bergamota', bergamota: 'Bergamota', bergamote: 'Bergamota',
  lemon: 'Limão-siciliano', lime: 'Limão', 'lime peel': 'Casca de limão', mandarin: 'Tangerina', 'mandarin orange': 'Tangerina',
  orange: 'Laranja', 'sicilian orange': 'Laranja-siciliana', 'blood orange': 'Laranja-sanguínea', 'bitter orange': 'Laranja-amarga',
  grapefruit: 'Toranja', 'grapefruit accord': 'Acorde de toranja', 'citrus notes': 'Notas cítricas', citruses: 'Cítricos', yuzu: 'Yuzu', neroli: 'Neroli',
  'orange blossom': 'Flor de laranjeira', petitgrain: 'Petitgrain',
  apple: 'Maçã', 'green apple': 'Maçã verde', 'granny smith': 'Maçã verde', pear: 'Pera', pineapple: 'Abacaxi', 'black currant': 'Cassis',
  blackcurrant: 'Cassis', cassis: 'Cassis', 'dragon fruit': 'Pitaia', mango: 'Manga', peach: 'Pêssego', plum: 'Ameixa', cherry: 'Cereja',
  raspberry: 'Framboesa', strawberry: 'Morango', 'red berries': 'Frutas vermelhas', coconut: 'Coco', 'coconut water': 'Água de coco',
  'tropical fruits': 'Frutas tropicais', melon: 'Melão', fig: 'Figo', 'fig leaf': 'Folha de figueira', rhubarb: 'Ruibarbo', 'rhubarb leaves': 'Folhas de ruibarbo',
  'pink pepper': 'Pimenta-rosa', 'pink peppercorn': 'Pimenta-rosa', 'black pepper': 'Pimenta-preta', 'sichuan pepper': 'Pimenta de Sichuan',
  pepper: 'Pimenta', cardamom: 'Cardamomo', cardamome: 'Cardamomo', cinnamon: 'Canela', nutmeg: 'Noz-moscada', ginger: 'Gengibre',
  saffron: 'Açafrão', clove: 'Cravo', cloves: 'Cravo', cumin: 'Cominho', aniseed: 'Anis', anise: 'Anis', 'star anise': 'Anis-estrelado', elemi: 'Elemi',
  pimento: 'Pimenta-da-jamaica', allspice: 'Pimenta-da-jamaica', lavender: 'Lavanda', lavandin: 'Lavandin', mint: 'Menta', basil: 'Manjericão',
  sage: 'Sálvia', 'clary sage': 'Sálvia esclareia', rosemary: 'Alecrim', thyme: 'Tomilho', artemisia: 'Artemísia',
  'green tea': 'Chá verde', tea: 'Chá', 'black tea': 'Chá preto', 'green notes': 'Notas verdes', 'aromatic notes': 'Notas aromáticas',
  'marine notes': 'Notas marinhas', 'sea notes': 'Notas marinhas', 'aquatic notes': 'Notas aquáticas', 'ozonic notes': 'Notas ozônicas',
  'earthy notes': 'Notas terrosas', 'woodsy notes': 'Notas amadeiradas', 'woody notes': 'Notas amadeiradas', aldehydes: 'Aldeídos',
  rose: 'Rosa', 'rosa centifolia': 'Rosa centifolia', 'turkish rose': 'Rosa turca', 'bulgarian rose': 'Rosa búlgara', 'damask rose': 'Rosa damascena',
  jasmine: 'Jasmim', 'jasmine sambac': 'Jasmim sambac', 'lily of the valley': 'Lírio-do-vale', lily: 'Lírio', violet: 'Violeta', iris: 'Íris',
  orris: 'Íris', geranium: 'Gerânio', magnolia: 'Magnólia', 'ylang-ylang': 'Ylang-ylang', 'ylang ylang': 'Ylang-ylang', tuberose: 'Tuberosa',
  gardenia: 'Gardênia', freesia: 'Frésia', peony: 'Peônia', carnation: 'Cravo (flor)', heliotrope: 'Heliotrópio', 'white floral': 'Floral branco',
  'white flowers': 'Flores brancas', 'tiare flower': 'Flor de tiaré', mimosa: 'Mimosa', osmanthus: 'Osmanthus', 'orange flower': 'Flor de laranjeira',
  vanilla: 'Baunilha', 'vanilla orchid': 'Orquídea de baunilha', 'madagascar vanilla': 'Baunilha de Madagascar', 'tonka bean': 'Fava-tonka',
  tonka: 'Fava-tonka', coumarin: 'Cumarina', honey: 'Mel', caramel: 'Caramelo', toffee: 'Toffee', praline: 'Praliné', chocolate: 'Chocolate',
  cacao: 'Cacau', cocoa: 'Cacau', coffee: 'Café', almond: 'Amêndoa', 'tobacco': 'Tabaco', 'tobacco leaf': 'Folha de tabaco', rum: 'Rum',
  cognac: 'Conhaque', whiskey: 'Uísque', 'sugar': 'Açúcar', benzoin: 'Benjoim', labdanum: 'Láudano', ciste: 'Esteva', cistus: 'Esteva',
  amber: 'Âmbar', ambergris: 'Âmbar-gris', ambroxan: 'Ambroxan', ambrofix: 'Ambrofix', 'white amber': 'Âmbar branco', incense: 'Incenso',
  frankincense: 'Olíbano', olibanum: 'Olíbano', myrrh: 'Mirra', oud: 'Oud', agarwood: 'Oud', resins: 'Resinas', 'tolu balsam': 'Bálsamo-de-tolu',
  musk: 'Almíscar', 'white musk': 'Almíscar branco', musks: 'Almíscares', cashmeran: 'Cashmeran', cashmere: 'Cashmere', 'cashmere wood': 'Madeira de cashmere',
  suede: 'Camurça', leather: 'Couro', patchouli: 'Patchouli', vetiver: 'Vetiver', 'indonesian vetiver': 'Vetiver indonésio', 'haitian vetiver': 'Vetiver haitiano',
  cedar: 'Cedro', cedarwood: 'Cedro', 'atlas cedar': 'Cedro-do-atlas', 'virginia cedar': 'Cedro-da-virgínia', sandalwood: 'Sândalo', wood: 'Madeiras',
  woods: 'Madeiras', 'dry woods': 'Madeiras secas', 'white woods': 'Madeiras brancas', guaiac: 'Guaiaco', 'guaiac wood': 'Guaiaco', birch: 'Bétula',
  'oak moss': 'Musgo de carvalho', oakmoss: 'Musgo de carvalho', moss: 'Musgo', 'tree moss': 'Musgo', akigalawood: 'Akigalawood', papyrus: 'Papiro',
  mahonial: 'Mahonial', iso: 'Iso E Super', 'iso e super': 'Iso E Super', salt: 'Sal', 'sea salt': 'Sal marinho', smoke: 'Fumaça', birchwood: 'Bétula',
  'french sage': 'Sálvia francesa', 'egyptian jasmine': 'Jasmim egípcio', 'indian jasmine': 'Jasmim indiano', 'italian bergamot': 'Bergamota italiana',
  'calabrian bergamot': 'Bergamota da Calábria', 'italian lemon': 'Limão italiano', 'bourbon vanilla': 'Baunilha bourbon',
  'cambodian oud': 'Oud cambojano', 'fruity notes': 'Notas frutadas', 'floral notes': 'Notas florais', 'spicy notes': 'Notas especiadas',
  'chypre accord': 'Acorde chipre', 'fougere accord': 'Acorde fougère',
  // espanhol (algumas revendedoras publicam assim)
  'té verde': 'Chá verde', manzana: 'Maçã', 'pimienta rosa': 'Pimenta-rosa', 'pimienta de sichuan': 'Pimenta de Sichuan', geranio: 'Gerânio',
  'grosella negra': 'Cassis', ámbar: 'Âmbar', cedro: 'Cedro', almizcle: 'Almíscar',
};

const ACCORDS: Record<string, string> = {
  fresh: 'Fresco', citrus: 'Cítrico', citrusy: 'Cítrico', fruity: 'Frutado', floral: 'Floral', 'white floral': 'Floral branco', woody: 'Amadeirado',
  green: 'Verde', aromatic: 'Aromático', spicy: 'Especiado', 'warm spicy': 'Especiado quente', 'fresh spicy': 'Especiado fresco', sweet: 'Doce',
  gourmand: 'Gourmand', creamy: 'Cremoso', powdery: 'Atalcado', musky: 'Almiscarado', amber: 'Âmbar', ambery: 'Âmbar', oriental: 'Oriental',
  balsamic: 'Balsâmico', vanilla: 'Baunilhado', leather: 'Couro', leathery: 'Couro', smoky: 'Esfumaçado', earthy: 'Terroso', aquatic: 'Aquático',
  marine: 'Marinho', ozonic: 'Ozônico', synthetic: 'Sintético', animalic: 'Animálico', resinous: 'Resinoso', tobacco: 'Tabaco', honey: 'Mel',
  coffee: 'Café', oud: 'Oud', mossy: 'Musgoso', chypre: 'Chipre', fougere: 'Fougère', 'soft spicy': 'Especiado suave', rose: 'Rosa', lavender: 'Lavanda',
  tropical: 'Tropical', 'yellow floral': 'Floral amarelo', iris: 'Íris', violet: 'Violeta', herbal: 'Herbal', salty: 'Salgado', metallic: 'Metálico',
  woodsy: 'Amadeirado', cinnamon: 'Canela', cherry: 'Cereja', coconut: 'Coco', nutty: 'Amendoado', caramel: 'Caramelo', 'cacao': 'Cacau',
};

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export const noteLabel = (note: string) => NOTES[key(note)] ?? note.charAt(0).toUpperCase() + note.slice(1);
export const accordLabel = (accord: string) => ACCORDS[key(accord)] ?? accord.charAt(0).toUpperCase() + accord.slice(1);
