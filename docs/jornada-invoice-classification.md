# Classificação de NF-e: consulta versus tratamento

Fonte única: `lib/funnel/fullJourney.ts`, funções `journeyInvoiceKind` e
`invoiceStatusIsAuthorized`. A Jornada e o filtro **Mais filtros > Tratamento
pago (NF-e)** de **Clientes** utilizam essas funções.

- **Consulta** (`evaluation`): descrição classificada como `evaluation` por
  `classifyInvoiceDescription` em `lib/invoices/categories.ts` **ou**
  descrição contendo a palavra `consulta` (regex `/\bconsulta\b/i`).
- **Tratamento** (`procedure`): qualquer outra descrição de NF-e, inclusive
  exames, armazenamento, genética e outras categorias não classificadas
  como avaliação. Esta é a classificação *atual* da Jornada; não limitar a FIV.
- **Pago**: status de NF-e autorizado pela regra da Jornada (começa por
  `Autorizada`, ou corresponde a cancelamento negado/rejeitado). NF-es
  canceladas, negadas ou aguardando autorização não contam.
- **Sem critério de valor:** nunca usar `amount`, preço mínimo ou faixa de
  faturamento para decidir se é tratamento ou consulta. Um cliente entra no
  filtro "Sim" com pelo menos uma NF-e autorizada classificada como tratamento,
  independentemente de seu valor e data. O período da página continua
  filtrando a última interação do cliente, não a emissão da NF-e.

Qualquer revisão de classificação deve partir dessas funções compartilhadas,
para que Jornada e Clientes continuem consistentes.

**WhatsApp rastreado:** o filtro de Clientes verifica se existe ao menos uma
conversa WhatsApp com as mesmas evidências aceitas na cobertura da Jornada:
origem na conversa; TinTim rastreado associado à conversa (evento do mesmo
cliente a até 2 dias); ou dados de origem, UTM e IDs de clique do cliente
atualizados a até 7 dias da conversa. As regras de evidência e proximidade
estão em `lib/funnel/whatsappTracking.ts`; nenhuma conversa rastreada é "Não".
