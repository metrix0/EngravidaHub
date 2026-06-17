// app/src/lib/units/resolveClosestUnitFromPhone.ts
import { supabase } from "@engravida/lib";

type Coordinates = {
    city: string;
    lat: number;
    lng: number;
};

type UnitRow = {
    id: string;
    name: string;
};

const UNIT_COORDS_BY_NAME: Record<string, Coordinates> = {
    bauru: {
        city: "Bauru",
        lat: -22.3145,
        lng: -49.0587,
    },
    "belo horizonte": {
        city: "Belo Horizonte",
        lat: -19.9167,
        lng: -43.9345,
    },
    brasilia: {
        city: "Brasília",
        lat: -15.7939,
        lng: -47.8828,
    },
    campinas: {
        city: "Campinas",
        lat: -22.9056,
        lng: -47.0608,
    },
    "juiz de fora": {
        city: "Juiz de Fora",
        lat: -21.7642,
        lng: -43.3503,
    },
    manaus: {
        city: "Manaus",
        lat: -3.119,
        lng: -60.0217,
    },
    "rio de janeiro": {
        city: "Rio de Janeiro",
        lat: -22.9068,
        lng: -43.1729,
    },
    salvador: {
        city: "Salvador",
        lat: -12.9777,
        lng: -38.5016,
    },
    "sao paulo": {
        city: "São Paulo",
        lat: -23.5505,
        lng: -46.6333,
    },
    "vitoria": {
        city: "Vitória",
        lat: -20.3155,
        lng: -40.3128,
    },
};

const DDD_CITY_COORDS: Record<string, Coordinates> = {
    "11": { city: "São Paulo", lat: -23.5505, lng: -46.6333 },
    "12": { city: "São José dos Campos", lat: -23.2237, lng: -45.9009 },
    "13": { city: "Santos", lat: -23.9608, lng: -46.3336 },
    "14": { city: "Bauru", lat: -22.3145, lng: -49.0587 },
    "15": { city: "Sorocaba", lat: -23.5015, lng: -47.4526 },
    "16": { city: "Ribeirão Preto", lat: -21.1775, lng: -47.8103 },
    "17": { city: "São José do Rio Preto", lat: -20.8113, lng: -49.3758 },
    "18": { city: "Presidente Prudente", lat: -22.1207, lng: -51.3925 },
    "19": { city: "Campinas", lat: -22.9056, lng: -47.0608 },

    "21": { city: "Rio de Janeiro", lat: -22.9068, lng: -43.1729 },
    "22": { city: "Campos dos Goytacazes", lat: -21.7622, lng: -41.3181 },
    "24": { city: "Volta Redonda", lat: -22.5202, lng: -44.0996 },
    "27": { city: "Vitória", lat: -20.3155, lng: -40.3128 },
    "28": { city: "Cachoeiro de Itapemirim", lat: -20.8489, lng: -41.1129 },

    "31": { city: "Belo Horizonte", lat: -19.9167, lng: -43.9345 },
    "32": { city: "Juiz de Fora", lat: -21.7642, lng: -43.3503 },
    "33": { city: "Governador Valadares", lat: -18.8549, lng: -41.9559 },
    "34": { city: "Uberlândia", lat: -18.9186, lng: -48.2772 },
    "35": { city: "Poços de Caldas", lat: -21.7854, lng: -46.5614 },
    "37": { city: "Divinópolis", lat: -20.1389, lng: -44.8839 },
    "38": { city: "Montes Claros", lat: -16.7286, lng: -43.8578 },

    "41": { city: "Curitiba", lat: -25.4284, lng: -49.2733 },
    "42": { city: "Ponta Grossa", lat: -25.0945, lng: -50.1633 },
    "43": { city: "Londrina", lat: -23.3045, lng: -51.1696 },
    "44": { city: "Maringá", lat: -23.4205, lng: -51.9333 },
    "45": { city: "Cascavel", lat: -24.9555, lng: -53.4552 },
    "46": { city: "Francisco Beltrão", lat: -26.0817, lng: -53.0535 },
    "47": { city: "Joinville", lat: -26.3044, lng: -48.8487 },
    "48": { city: "Florianópolis", lat: -27.5949, lng: -48.5482 },
    "49": { city: "Chapecó", lat: -27.1004, lng: -52.6152 },

    "51": { city: "Porto Alegre", lat: -30.0346, lng: -51.2177 },
    "53": { city: "Pelotas", lat: -31.7654, lng: -52.3376 },
    "54": { city: "Caxias do Sul", lat: -29.1678, lng: -51.1794 },
    "55": { city: "Santa Maria", lat: -29.6868, lng: -53.8149 },

    "61": { city: "Brasília", lat: -15.7939, lng: -47.8828 },
    "62": { city: "Goiânia", lat: -16.6869, lng: -49.2648 },
    "63": { city: "Palmas", lat: -10.184, lng: -48.3336 },
    "64": { city: "Rio Verde", lat: -17.7923, lng: -50.9192 },
    "65": { city: "Cuiabá", lat: -15.601, lng: -56.0974 },
    "66": { city: "Sinop", lat: -11.8604, lng: -55.5091 },
    "67": { city: "Campo Grande", lat: -20.4697, lng: -54.6201 },
    "68": { city: "Rio Branco", lat: -9.9754, lng: -67.8249 },
    "69": { city: "Porto Velho", lat: -8.7608, lng: -63.8999 },

    "71": { city: "Salvador", lat: -12.9777, lng: -38.5016 },
    "73": { city: "Ilhéus", lat: -14.793, lng: -39.046 },
    "74": { city: "Juazeiro", lat: -9.4162, lng: -40.5033 },
    "75": { city: "Feira de Santana", lat: -12.2664, lng: -38.9663 },
    "77": { city: "Vitória da Conquista", lat: -14.8619, lng: -40.8442 },
    "79": { city: "Aracaju", lat: -10.9472, lng: -37.0731 },

    "81": { city: "Recife", lat: -8.0476, lng: -34.877 },
    "82": { city: "Maceió", lat: -9.6498, lng: -35.7089 },
    "83": { city: "João Pessoa", lat: -7.1195, lng: -34.845 },
    "84": { city: "Natal", lat: -5.7793, lng: -35.2009 },
    "85": { city: "Fortaleza", lat: -3.7319, lng: -38.5267 },
    "86": { city: "Teresina", lat: -5.0919, lng: -42.8034 },
    "87": { city: "Petrolina", lat: -9.3891, lng: -40.5027 },
    "88": { city: "Juazeiro do Norte", lat: -7.2131, lng: -39.315 },
    "89": { city: "Picos", lat: -7.0772, lng: -41.467 },

    "91": { city: "Belém", lat: -1.4558, lng: -48.4902 },
    "92": { city: "Manaus", lat: -3.119, lng: -60.0217 },
    "93": { city: "Santarém", lat: -2.4385, lng: -54.6996 },
    "94": { city: "Marabá", lat: -5.3686, lng: -49.1178 },
    "95": { city: "Boa Vista", lat: 2.8235, lng: -60.6758 },
    "96": { city: "Macapá", lat: 0.0349, lng: -51.0694 },
    "97": { city: "Tefé", lat: -3.3542, lng: -64.7114 },
    "98": { city: "São Luís", lat: -2.5307, lng: -44.3068 },
    "99": { city: "Imperatriz", lat: -5.5206, lng: -47.4718 },
};

export async function resolveClosestUnitIdFromPhone(phone: string | null) {
    const ddd = extractBrazilDdd(phone);

    if (!ddd) return null;

    const phoneLocation = DDD_CITY_COORDS[ddd];

    if (!phoneLocation) return null;

    const { data: units, error } = await supabase
        .from("units")
        .select("id, name")
        .eq("active", true);

    if (error) {
        throw error;
    }

    const rankedUnits = ((units ?? []) as UnitRow[])
        .map((unit) => {
            const unitLocation = UNIT_COORDS_BY_NAME[normalizeKey(unit.name)];

            if (!unitLocation) return null;

            return {
                unit,
                distanceKm: getDistanceKm(phoneLocation, unitLocation),
            };
        })
        .filter(Boolean) as Array<{
        unit: UnitRow;
        distanceKm: number;
    }>;

    rankedUnits.sort((a, b) => a.distanceKm - b.distanceKm);

    return rankedUnits[0]?.unit.id ?? null;
}

function extractBrazilDdd(phone: string | null) {
    if (!phone) return null;

    const digits = phone.replace(/\D/g, "");

    if (digits.startsWith("55") && digits.length >= 12) {
        return digits.slice(2, 4);
    }

    if (digits.length >= 10) {
        return digits.slice(0, 2);
    }

    return null;
}

function getDistanceKm(from: Coordinates, to: Coordinates) {
    const earthRadiusKm = 6371;

    const dLat = toRadians(to.lat - from.lat);
    const dLng = toRadians(to.lng - from.lng);

    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2) *
        Math.cos(lat1) *
        Math.cos(lat2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusKm * c;
}

function toRadians(value: number) {
    return (value * Math.PI) / 180;
}

function normalizeKey(value: string) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .trim();
}