import { notFound } from "next/navigation";

import OrcamentosDraft from "@/components/orcamentos/OrcamentosDraft";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";

export default async function OrcamentosPage() {
    const access = await getServerTabAccess("orcamentos");

    if (!access.ok) {
        notFound();
    }

    return <OrcamentosDraft />;
}
