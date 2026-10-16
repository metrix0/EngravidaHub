type ImageTable = { title: string; columns: string[]; rows: string[][] };
type ImageReport = { reportDate: string; horizonEnd: string; generatedAt: string; tables: ImageTable[] };

export function renderAgendaReportImage(canvas: HTMLCanvasElement, report: ImageReport, logo: { image: CanvasImageSource; width: number; height: number }, fontFamily = 'Inter, "Segoe UI", Arial, sans-serif') {
    const context = canvas.getContext("2d");
    if (!context) return false;
    const width = 1600, padding = 48, gap = 24, cardWidth = (width - padding * 2 - gap) / 2;
    const innerWidth = cardWidth - 40, lineHeight = 28;
    const font = (size: number, weight = 400) => { context.font = `${weight} ${size}px ${fontFamily}`; };
    const wrap = (value: string, maxWidth: number, size = 20, weight = 400) => {
        font(size, weight);
        const lines: string[] = [];
        let line = "";
        for (const word of value.split(/\s+/)) {
            const candidate = line ? `${line} ${word}` : word;
            if (line && context.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
            else line = candidate;
        }
        lines.push(line);
        return lines;
    };
    const layouts = report.tables.map(table => {
        const widths = table.columns.map((_, index) => innerWidth * (index === 0 ? 0.4 : 0.6 / (table.columns.length - 1)));
        const headings = table.columns.map((label, index) => wrap(label, widths[index] - 24, 17, 600));
        const headerHeight = Math.max(...headings.map(lines => lines.length)) * 24 + 24;
        const rows = table.rows.map(row => {
            const cells = row.map((value, index) => wrap(value, widths[index] - 24, 20, index === 0 ? 600 : 400));
            return { cells, height: Math.max(...cells.map(lines => lines.length)) * lineHeight + 20 };
        });
        return { ...table, widths, headings, headerHeight, rows, height: 80 + headerHeight + (rows.length ? rows.reduce((sum, row) => sum + row.height, 0) : 64) + 16 };
    });
    // Keep each unit on the same baseline in neighboring tables, even when
    // one of its values wraps to two lines.
    for (let index = 0; index < layouts.length; index += 2) {
        const pair = layouts.slice(index, index + 2), headerHeight = Math.max(...pair.map(table => table.headerHeight));
        for (let row = 0; row < Math.max(...pair.map(table => table.rows.length)); row++) {
            const rowHeight = Math.max(...pair.map(table => table.rows[row]?.height ?? 0));
            pair.forEach(table => { if (table.rows[row]) table.rows[row].height = rowHeight; });
        }
        pair.forEach(table => { table.headerHeight = headerHeight; table.height = 80 + headerHeight + (table.rows.length ? table.rows.reduce((sum, row) => sum + row.height, 0) : 64) + 16; });
    }
    const rowHeights = Array.from({ length: Math.ceil(layouts.length / 2) }, (_, index) => Math.max(...layouts.slice(index * 2, index * 2 + 2).map(table => table.height)));
    const footerTop = 184 + rowHeights.reduce((sum, height) => sum + height + gap, 0);
    const height = footerTop + 112;
    // Render at twice the layout size for crisp text when shared or zoomed.
    canvas.width = width * 2; canvas.height = height * 2;
    context.scale(2, 2); context.textBaseline = "top";
    context.fillStyle = "#f8fafc"; context.fillRect(0, 0, width, height);
    const text = (value: string, x: number, y: number, size: number, color: string, weight = 400, align: CanvasTextAlign = "left") => {
        font(size, weight); context.fillStyle = color; context.textAlign = align; context.fillText(value, x, y);
    };
    const rounded = (x: number, y: number, w: number, h: number, color: string, border?: string) => {
        context.beginPath(); context.roundRect(x, y, w, h, 20); context.fillStyle = color; context.fill();
        if (border) { context.strokeStyle = border; context.lineWidth = 1; context.stroke(); }
    };
    const logoHeight = 38;
    context.drawImage(logo.image, padding, 30, logoHeight * logo.width / logo.height, logoHeight);
    text("Disponibilidade de agendas", padding, 80, 38, "#0f172a", 700);
    const dateLabel = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${report.reportDate}T12:00:00Z`));
    text(dateLabel, padding, 134, 21, "#64748b");
    text(`Busca até ${report.horizonEnd.slice(0, 10).split("-").reverse().join("/")}`, width - padding, 134, 19, "#64748b", 400, "right");
    let y = 184;
    rowHeights.forEach((rowHeight, rowIndex) => {
        layouts.slice(rowIndex * 2, rowIndex * 2 + 2).forEach((table, columnIndex) => {
            const x = padding + columnIndex * (cardWidth + gap), left = x + 20;
            rounded(x, y, cardWidth, rowHeight, "#ffffff", "#dadfe8");
            text(table.title, left + 4, y + 26, 25, "#0f172a", 700);
            let top = y + 80;
            context.fillStyle = "#f1f5f9"; context.fillRect(left, top, innerWidth, table.headerHeight);
            const drawCells = (cells: string[][], cellTop: number, cellHeight: number, heading = false) => {
                let cellX = left;
                cells.forEach((lines, index) => {
                    const leading = heading ? 24 : lineHeight;
                    lines.forEach((line, lineIndex) => text(line, index === 0 ? cellX + 12 : cellX + table.widths[index] / 2, cellTop + (cellHeight - lines.length * leading) / 2 + lineIndex * leading, heading ? 17 : 20, heading ? "#64748b" : "#0f172a", heading || index === 0 ? 600 : 400, index === 0 ? "left" : "center"));
                    cellX += table.widths[index];
                });
            };
            drawCells(table.headings, top, table.headerHeight, true); top += table.headerHeight;
            table.rows.forEach((row, index) => {
                if (index % 2) { context.fillStyle = "#fafbfd"; context.fillRect(left, top, innerWidth, row.height); }
                drawCells(row.cells, top, row.height);
                top += row.height;
                context.beginPath(); context.moveTo(left, top); context.lineTo(left + innerWidth, top); context.strokeStyle = "#eef2f6"; context.stroke();
            });
            if (!table.rows.length) text("Nenhuma agenda para os filtros selecionados.", left + 12, top + 20, 19, "#64748b");
        });
        y += rowHeight + gap;
    });
    text("3+ = pelo menos três horários livres no mesmo dia, somando os médicos da unidade.", padding, footerTop + 4, 18, "#64748b");
    text(`Atualizado em ${new Date(report.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, padding, footerTop + 46, 18, "#64748b");
    return true;
}
