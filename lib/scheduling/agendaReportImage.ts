type ImageTable = { title: string; columns: string[]; rows: string[][] };
type ImageReport = { reportDate: string; horizonEnd: string; generatedAt: string; tables: ImageTable[]; scope?: string };

export function renderAgendaReportImage(canvas: HTMLCanvasElement, report: ImageReport, logo: { image: CanvasImageSource; width: number; height: number }, fontFamily = 'Inter, "Segoe UI", Arial, sans-serif') {
    const context = canvas.getContext("2d");
    if (!context) return false;

    const width = 1080, padding = 56, contentWidth = width - padding * 2;
    const ink = "#20242c", muted = "#89909c", brand = "#b2404d", border = "#e9eaee";
    const font = (size: number, weight = 400) => { context.font = `${weight} ${size}px ${fontFamily}`; };
    const wrap = (value: string, maxWidth: number, size: number, weight = 400) => {
        font(size, weight);
        const lines: string[] = [];
        let line = "";
        for (const word of value.split(/\s+/)) {
            const next = line ? `${line} ${word}` : word;
            if (line && context.measureText(next).width > maxWidth) { lines.push(line); line = word; }
            else line = next;
        }
        lines.push(line);
        return lines;
    };
    const sections = report.tables.map((table, index) => {
        const firstWidth = index === 3 ? 0.4 : index === 2 ? 0.38 : 0.43;
        const widths = table.columns.map((_, col) => contentWidth * (col === 0 ? firstWidth : (1 - firstWidth) / (table.columns.length - 1)));
        const title = ["TEMPO DE ESPERA", "PRÓXIMAS DATAS DISPONÍVEIS", "DISPONIBILIDADE ATUAL E PRÓXIMAS 3 SEMANAS", "PRÓXIMOS SÁBADOS DISPONÍVEIS"][index] ?? table.title.toLocaleUpperCase("pt-BR");
        const columns = table.columns.map((label, col) => {
            const replacement = index === 0 ? ["UNIDADE", "1ª VAGA", "3+ VAGAS¹"] : index === 1 ? ["UNIDADE", "1ª", "2ª", "3ª"] : index === 2 ? ["UNIDADE", "SEM. ATUAL", "SEM. 1", "SEM. 2", "SEM. 3"] : [];
            return replacement[col] ?? label.toLocaleUpperCase("pt-BR");
        });
        const rows = table.rows.map(row => {
            const cells = row.map((value, col) => wrap(index === 3 && col === 1 ? value.replaceAll(" (3+)", "¹") : value, widths[col] - (col ? 24 : 16), col === 0 ? 21 : 20, col === 0 ? 500 : 400));
            return { cells, height: Math.max(56, ...cells.map(lines => lines.length * 27 + 20)) };
        });
        const headingHeight = index === 3 ? 0 : 50;
        const bodyHeight = rows.length ? rows.reduce((sum, row) => sum + row.height, 0) : 60;
        return { title, columns, widths, rows, headingHeight, height: 62 + headingHeight + bodyHeight + 28 };
    });
    const headerHeight = report.scope ? 263 : 237;
    const footerHeight = 158;
    const height = headerHeight + 33 + sections.reduce((sum, section) => sum + section.height, 0) + footerHeight;
    const scale = 1.5;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.scale(scale, scale);
    context.textBaseline = "top";
    const fill = (color: string, x: number, y: number, w: number, h: number) => { context.fillStyle = color; context.fillRect(x, y, w, h); };
    const text = (value: string, x: number, y: number, size: number, color: string, weight = 400, align: CanvasTextAlign = "left") => {
        font(size, weight); context.fillStyle = color; context.textAlign = align; context.fillText(value, x, y);
    };
    const textFit = (value: string, x: number, y: number, maxWidth: number, size: number, color: string, weight = 400, align: CanvasTextAlign = "left") => {
        font(size, weight);
        while (size > 15 && context.measureText(value).width > maxWidth) { size -= 1; font(size, weight); }
        text(value, x, y, size, color, weight, align);
    };
    const cellColor = (section: number, value: string) => {
        if (value === "—" || /^(Sem |Não atende)/.test(value)) return muted;
        if (section === 0) {
            const wait = parseInt(value, 10);
            return Number.isFinite(wait) ? wait <= 2 ? "#158752" : wait <= 10 ? "#b78212" : "#c43644" : ink;
        }
        if (section === 2) {
            const count = Number(value);
            return Number.isFinite(count) ? count === 0 ? "#cf3947" : count >= 6 ? "#159353" : "#b78212" : ink;
        }
        return ink;
    };

    // The report is a portrait document, readable as a single shared image.
    const gradient = context.createLinearGradient(0, 0, width, headerHeight);
    gradient.addColorStop(0, "#c34a56"); gradient.addColorStop(1, "#9f3544");
    context.fillStyle = gradient; context.fillRect(0, 0, width, headerHeight);
    const logoMaxWidth = 198, logoMaxHeight = 52;
    const logoRatio = Math.min(logoMaxWidth / logo.width, logoMaxHeight / logo.height);
    const logoWidth = logo.width * logoRatio, logoHeight = logo.height * logoRatio;
    context.beginPath(); context.roundRect(padding, 31, 218, 66, 12); context.fillStyle = "#ffffff"; context.fill();
    context.drawImage(logo.image, padding + (218 - logoWidth) / 2, 31 + (66 - logoHeight) / 2, logoWidth, logoHeight);
    text("RELATÓRIO DIÁRIO", width - padding, 51, 18, "#ffe9ed", 700, "right");
    text("Disponibilidade de Agendas", padding, 122, 42, "#ffffff", 700);
    const dateLabel = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${report.reportDate}T12:00:00Z`));
    text(dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1), padding, 185, 24, "#fff0f1");
    if (report.scope) textFit(report.scope, padding, 227, contentWidth, 18, "#ffe2e6");

    fill("#ffffff", 0, headerHeight, width, height - headerHeight);
    let top = headerHeight + 33;
    sections.forEach((section, sectionIndex) => {
        // Section labels and rules are shared across all four tables.
        fill(brand, padding, top + 5, 5, 23);
        textFit(section.title, padding + 19, top + 4, contentWidth - 19, 21, brand, 700);
        fill("#eadde0", padding, top + 43, contentWidth, 2);
        top += 62;
        if (section.headingHeight) {
            fill("#fafafb", padding, top, contentWidth, section.headingHeight);
            let x = padding;
            section.columns.forEach((value, col) => {
                const cellWidth = section.widths[col];
                textFit(value, col === 0 ? x + 6 : x + cellWidth / 2, top + 16, cellWidth - 16, 16, "#777e8a", 600, col === 0 ? "left" : "center");
                x += cellWidth;
            });
            top += section.headingHeight;
        }
        if (!section.rows.length) {
            text("Nenhuma unidade disponível para os filtros selecionados.", padding + 8, top + 20, 20, muted);
            top += 60;
        }
        section.rows.forEach((row, rowIndex) => {
            if (rowIndex % 2 === 1) fill("#fcfcfd", padding, top, contentWidth, row.height);
            let x = padding;
            row.cells.forEach((lines, col) => {
                const cellWidth = section.widths[col];
                const lineHeight = 27, textHeight = lines.length * lineHeight;
                const align: CanvasTextAlign = col === 0 ? "left" : sectionIndex === 3 ? "right" : "center";
                const textX = col === 0 ? x + 6 : sectionIndex === 3 ? x + cellWidth - 6 : x + cellWidth / 2;
                lines.forEach((line, lineIndex) => {
                    const color = col === 0 ? ink : cellColor(sectionIndex, line);
                    const weight = col === 0 || (sectionIndex === 0 || sectionIndex === 2) && color !== muted ? 600 : 400;
                    textFit(line, textX, top + (row.height - textHeight) / 2 + lineIndex * lineHeight, cellWidth - 14, col === 0 ? 21 : 20, color, weight, align);
                });
                x += cellWidth;
            });
            top += row.height;
            fill(border, padding, top - 1, contentWidth, 1);
        });
        top += 28;
    });
    fill("#f8f8fa", 0, top + 5, width, footerHeight - 5);
    fill("#e8e9ed", padding, top + 5, contentWidth, 1);
    text("¹ 3+ vagas livres no mesmo dia, somando todos os médicos da unidade.", padding, top + 26, 18, "#777e8a");
    const updated = new Date(report.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
    const horizon = `${report.horizonEnd.slice(8, 10)}/${report.horizonEnd.slice(5, 7)}/${report.horizonEnd.slice(0, 4)}`;
    text(`Atualizado em ${updated}`, padding, top + 77, 18, "#777e8a");
    text(`Busca até ${horizon}`, width - padding, top + 77, 18, "#777e8a", 400, "right");
    return true;
}
