import { notFound } from "next/navigation";

import OrcamentosDraft from "@/components/orcamentos/OrcamentosDraft";
import { getServerTabAccess } from "@/lib/auth/getServerTabAccess";
import { budgetUnitForLock } from "@/lib/orcamentos/budget";

export default async function OrcamentosPage() {
    const access = await getServerTabAccess("orcamentos");

    if (!access.ok) {
        notFound();
    }

    return <OrcamentosDraft lockedUnit={budgetUnitForLock(access.permission.unit_lock)} defaultResponsible={access.user.name} />;
}
