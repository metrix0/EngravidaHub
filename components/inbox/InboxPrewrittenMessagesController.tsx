// components/inbox/InboxPrewrittenMessagesController.tsx
"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type RefObject,
} from "react";
import {createPortal} from "react-dom";
import {LoaderCircle, PencilLine, Send} from "lucide-react";
import {usePathname} from "next/navigation";

export type PrewrittenMessage = {
    id: string;
    command: string;
    text: string;
};

export const PREWRITTEN_MESSAGES: PrewrittenMessage[] = [
    {
        id: "selg-1",
        command: "/SELG",
        text: "Se desejar agendar uma consulta por favor clique no link a seguir e envie a mensagem pelo nosso Whatsapp: https://clinica.engravida.com.br/direct-1",
    },
    {
        id: "sela-2",
        command: "/SELA",
        text: "https://clinica.engravida.com.br/direct-2",
    },
    {
        id: "seco-3",
        command: "/SECO",
        text: "https://clinica.engravida.com.br/direct-3",
    },
    {
        id: "sepr-4",
        command: "/SEPR",
        text: "Se desejar agendar uma consulta por favor clique no link a seguir e envie a mensagem pelo nosso Whatsapp: https://clinica.engravida.com.br/direct-4",
    },
    {
        id: "rty-5",
        command: "/rty",
        text: "O método ROPA é um procedimento de reprodução assistida que atribui papel ativo às duas mulheres. Uma delas será a doadora de óvulos, ou seja, o bebê terá a carga genética dela, enquanto a outra mulher será a receptora do embrião, portanto a gestante, que dará à luz o bebê.",
    },
    {
        id: "fgh-6",
        command: "/fgh",
        text: "No método ROPA, o valor da FIV é de R$ 12.000,00.\nNesse valor estão incluídas as consultas de controle de ovulação, a coleta de óvulos com anestesia, a fertilização do óvulo com o sêmen para formação dos embriões e o congelamento dos embriões.\nAs medicações são cobradas separadamente por dia de uso, no valor de R$ 360,00 por dia (dose de 225ui). Em média, são utilizados cerca de 10 dias.\nQuando ocorre, a transferência do embrião tem o valor de R$ 3.000,00 e já inclui as consultas de preparo do endométrio.\nO valor do sêmen do doador é de R$ 4.000,00.\nSomando todas as etapas, o tratamento fica em torno de R$ 23.000,00.\nOs valores informados são para pagamento à vista, podendo ser parcelados em até 12x, com juros de 2% ao mês.\nReforçamos que o tratamento é individualizado, por isso é importante avaliar o caso com um médico de nosso corpo clínico para definir a melhor conduta.\nO valor da consulta para o casal é de R$ 250,00 com pagamento antecipado ou R$ 300,00 no dia, incluso um retorno.",
    },
    {
        id: "vbn-7",
        command: "/vbn",
        text: "Os valores informados são para pagamento à vista, podendo ser parcelados em até 12x, com juros de 2% ao mês.\nNo boleto ou PIX, é possível parcelar em até 12x sem juros, porém o tratamento é iniciado após o pagamento de algumas parcelas, normalmente a partir da oitava. Também é possível dar uma entrada ou pagar parte no cartão para iniciar antes.\nTemos uma equipe de orçamento que busca sempre se ajustar à necessidade do casal.",
    },
    {
        id: "bnm-8",
        command: "/bnm",
        text: "Você tem uma companheira? Quais são as idades de vocês?",
    },
    {
        id: "homofiv-9",
        command: "/Homofiv",
        text: "Nesse caso vocês poderiam fazer um ciclo de doação de óvulos (para mulheres que estão aguardando na fila como receptoras) e obterem um abatimento de 3 mil reais no tratamento de vocês (por cada uma que doar). Para doar é preciso estar saudável e ter entre 18 e 35 anos. Além de realizar um ato de amor, vocês podem obter um abatimento.",
    },
    {
        id: "ert-10",
        command: "/ERT",
        text: "Temos clínicas em:\n\nSP  👉 São Paulo (SP);\n 👉 Bauru (SP);\n 👉 Campinas (SP);\nMG 👉 Belo Horizinte (BH);\n👉 Juiz de Fora (MG);\nRJ   👉 Rio de Janeiro (RJ);\nBA  👉 Salvador (BA);\nDF  👉 Brasília (DF);\nAM 👉 Manaus (AM);\nES 👉 Vitória (ES).\n\nQual dessas seria a unidade ideal pra você?",
    },
    {
        id: "humo-11",
        command: "/Humo",
        text: "Nesse caso vocês poderiam fazer um ciclo de doação de óvulos (para mulheres que estão aguardando na fila como receptoras) e obterem um abatimento de 3 mil reais no tratamento de vocês. Para doar é preciso estar saudável e ter entre 18 e 35 anos. Além de realizar um ato de amor, vocês podem obter um abatimento.",
    },
    {
        id: "rig-12",
        command: "/Rig",
        text: "Oferecemos uma ampla gama de doadores para que você possa escolher entre os mais variados perfis. Cada amostra doada passa por testes rigorosos para garantir a segurança e aumentar as taxas de sucesso de gravidez. Podem encontrar os perfis nesse link: https://engravida.com.br/doadores",
    },
    {
        id: "ideal-13",
        command: "/Ideal",
        text: "O ideal é passar em uma consulta com um médico especialista em reprodução humana.",
    },
    {
        id: "consulta-14",
        command: "/Consulta",
        text: "O valor da consulta para o casal é de 300 reais no dia (ou 250 reais para pagamento adiantado) e dá direito a um retorno em até 90 dias. Pode ser presencial ou online.",
    },
    {
        id: "sao-15",
        command: "/sao",
        text: "Em SP ficamos na Avenida Angélica, 916 - térreo. Próximo ao metrô Santa Cecília.",
    },
    {
        id: "bau-16",
        command: "/bau",
        text: "Em Bauru ficamos na Av. Comendador José da Silva Martha, 3-30 - Jardim Estoril",
    },
    {
        id: "campinas-17",
        command: "/campinas",
        text: "Em Campinas ficamos na Rua Barão de Atibaia, 200 - Vila Itapura",
    },
    {
        id: "bbh-18",
        command: "/BBH",
        text: "Em Belo Horizonte ficamos na Av. do Contorno, 4461 - Funcionários, Belo Horizonte - MG, Brasil CEP: 30110-032",
    },
    {
        id: "jdf-19",
        command: "/jdf",
        text: "Em Juiz de Fora ficamos na R. Dr. José Cesário, 82 - 3º andar - Passos - Primeira direita após o HPS (Hospital Pronto Socorro)",
    },
    {
        id: "rio-20",
        command: "/rio",
        text: "Ficamos na cidade do Rio de Janeiro em Botafogo. Rua São Clemente 347",
    },
    {
        id: "ssa-21",
        command: "/ssa",
        text: "Em Salvador ficamos no Caminho das Árvores, na Alameda das Algarobas 102",
    },
    {
        id: "bsb-22",
        command: "/bsb",
        text: "Em Brasília ficamos na Asa Sul, no Centro Médico Julio Adnet - SEPS SEP sul, 709/909",
    },
    {
        id: "ama-23",
        command: "/ama",
        text: "Em Manaus ficamos na Travessa Palmira, nº 41 - Adrianópolis",
    },
    {
        id: "vit-24",
        command: "/vit",
        text: "Em Vitória ficamos na Av. Paulino Muller, 87 - B - Ilha de Santa Maria. **Atrás da Receita Federal, próximo à beira mar.**",
    },
    {
        id: "trans-25",
        command: "/trans",
        text: "No caso do tratamento para pessoas trans, a solução é a realização de uma FIV com sêmen de doador.\nO valor da FIV é de R$ 12.000,00.\nNesse valor estão incluídas as consultas de controle de ovulação, a coleta de óvulos com anestesia, a fertilização do óvulo com o sêmen para formação dos embriões e o congelamento dos embriões.\nAs medicações são cobradas separadamente por dia de uso, no valor de R$ 360,00 por dia (dose de 225ui). Em média, são utilizados cerca de 10 dias.\nQuando ocorre, a transferência do embrião tem o valor de R$ 3.000,00 e já inclui as consultas de preparo do endométrio.\nO valor do sêmen do doador é de R$ 4.000,00.\nSomando todas as etapas, o tratamento fica em torno de R$ 23.000,00.\nOs valores informados são para pagamento à vista, podendo ser parcelados em até 12x, com juros de 2% ao mês.\nReforçamos que o tratamento é individualizado, por isso é importante avaliar o caso com um médico de nosso corpo clínico para definir a melhor conduta.",
    },
    {
        id: "masc1-26",
        command: "/masc1",
        text: "Nesse caso  precisariam de uma barriga de aluguel e óvulos doados.",
    },
    {
        id: "masc2-27",
        command: "/masc2",
        text: "No Brasil, a barriga de aluguel é chamada de útero por substituição ou barriga solidária e o processo ocorre da seguinte forma: quem comprovadamente não pode engravidar busca auxílio de alguém que aceite que o bebê se desenvolva em seu ventre. Esse recurso é chamado de cessão uterina temporária, pois o útero de uma mulher é cedido à outra pessoa pelo tempo que durar a gestação.  A mulher que aceitar colaborar deve ser parente de até quarto grau da pessoa que precisa de ajuda para ter um bebê (ou seja, tem de ser mãe, irmã, tia, avó ou prima). Além disso, ela deve ser saudável o suficiente para que a gestação não seja um risco para ela ou para a criança. E o mais importante! A iniciativa deve ser voluntária e solidária, sem nenhum caráter lucrativo ou comercial, de forma que nenhuma mulher pode ser paga para aceitar que seu útero seja usado em substituição ao de quem tem dificuldade para abrigar um bebê no próprio ventre. Caso essa transação seja feita, o processo torna-se ilegal.",
    },
    {
        id: "masc3-28",
        command: "/masc3",
        text: "O valor do procedimento com útero de substituição é de R$ 27.800,00.\nNesse valor estão incluídos os óvulos doados, a fertilização do óvulo com o sêmen para formação do embrião, a transferência do embrião para o útero de substituição, a avaliação da mulher que será a barriga solidária e toda a documentação necessária para o processo.\nOs valores informados são para pagamento à vista, podendo ser parcelados em até 12x, com juros de 2% ao mês.\nNo boleto ou PIX, é possível parcelar em até 12x sem juros, porém o tratamento é iniciado após o pagamento de algumas parcelas, normalmente a partir da oitava. Também é possível dar uma entrada ou pagar parte no cartão para iniciar antes. Nossa equipe de orçamento busca sempre se ajustar à necessidade do casal.\nO valor da consulta é de R$ 250,00 com pagamento antecipado ou R$ 300,00 no dia, incluso um retorno.\nO tratamento é individualizado, por isso é importante avaliar o caso com um médico de nosso corpo clínico para definir a melhor conduta.",
    },
    {
        id: "cedente-29",
        command: "/CEDENTE",
        text: "Para o caso de uma gravidez com cedente do útero sem consanguinidade (parentesco até quarto grau), após a primeira avaliação faremos a solicitação de toda a documentação necessária para ser entregue com reconhecimento em cartório. Enviaremos a solicitação e a documentação ao Conselho de Medicina local. Na maioria dos casos se obtém sucesso e historicamente o prazo para a resposta é um pouco demorado, por volta de 6 meses a 1 ano. O valor para essa solicitação é de 600 reais.",
    },
    {
        id: "indh1-30",
        command: "/indh1",
        text: "Sim, seria uma produção independente. Utilizaremos o seu sêmen com os óvulos de uma doadora para formar um embrião e iremos transferir esse embrião para algum útero de substituição.",
    },
    {
        id: "indh2-31",
        command: "/indh2",
        text: "No Brasil, a barriga de aluguel é chamada de útero por substituição ou barriga solidária e o processo ocorre da seguinte forma: alguém que não pode engravidar busca auxílio de uma mulher que aceite que o bebê se desenvolva em seu ventre. Esse recurso é chamado de cessão uterina temporária, pois o útero de uma mulher é cedido à outra pessoa pelo tempo que durar a gestação.  A mulher que aceitar colaborar deve ser parente de até quarto grau da pessoa que precisa de ajuda para ter um bebê (ou seja, tem de ser mãe, irmã, tia, avó ou prima). Além disso, ela deve ser saudável o suficiente para que a gestação não seja um risco para ela ou para a criança.  E o mais importante! A iniciativa deve ser voluntária e solidária, sem nenhum caráter lucrativo ou comercial, de forma que nenhuma mulher possa ser paga para aceitar que seu útero seja usado em substituição ao de quem tem dificuldade ou não possa abrigar um bebê no próprio ventre. Caso essa transação seja feita, o processo torna-se ilegal.",
    },
    {
        id: "qwe-32",
        command: "/qwe",
        text: "Olá, para quem realizou laqueadura e tem o desejo de engravidar a solução adequada é a fertilização in vitro.",
    },
    {
        id: "asd-33",
        command: "/asd",
        text: "O valor da FIV é de R$ 12.000,00.\nNesse valor estão incluídas as consultas de controle de ovulação, a coleta de óvulos com anestesia, a coleta do sêmen, a fertilização do óvulo com o sêmen para formação dos embriões e o congelamento dos embriões.\nAs medicações são cobradas separadamente por dia de uso, no valor de R$ 360,00 por dia (dose de 225ui). Em média, são utilizados cerca de 10 dias.\nQuando ocorrer, a transferência do embrião tem o valor de R$ 3.000,00 e já inclui as consultas de preparo do endométrio.\nOs valores informados são para pagamento à vista, podendo ser parcelados em até 12x, com juros de 2% ao mês.\nLembramos que o tratamento é individualizado, por isso é importante a realização de uma avaliação para uma confirmação mais precisa dos valores.\nO valor da consulta é de R$ 250,00 com pagamento antecipado ou R$ 300,00 no dia, com direito a um retorno.",
    },
    {
        id: "cvb-34",
        command: "/cvb",
        text: "Quantos anos você tem?",
    },
    {
        id: "25a-35",
        command: "/25a",
        text: "Com idade de (25 a 36 anos), se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir para uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "26a-36",
        command: "/26a",
        text: "Com idade de (25 a 36 anos), se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir para uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "27a-37",
        command: "/27a",
        text: "Com idade de (25 a 36 anos), se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir para uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "28a-38",
        command: "/28a",
        text: "Com idade de (25 a 36 anos), se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir para uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "29a-39",
        command: "/29a",
        text: "Com idade de (25 a 36 anos), se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir para uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "30a-40",
        command: "/30a",
        text: "Com idade de (25 a 36 anos), se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir para uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "31a-41",
        command: "/31a",
        text: "Com idade de (25 a 36 anos), se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir para uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "32a-42",
        command: "/32a",
        text: "Com idade de (25 a 36 anos), se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir para uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "33a-43",
        command: "/33a",
        text: "Com idade de (25 a 36 anos), se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir para uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "34a-44",
        command: "/34a",
        text: "Com idade de (25 a 36 anos), se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir para uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "35a-45",
        command: "/35a",
        text: "Com idade de (25 a 36 anos), se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir para uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "36a-46",
        command: "/36a",
        text: "Com idade de (25 a 36 anos), se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir para uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "123-47",
        command: "/123",
        text: "O valor da FIV é de R$ 12.000,00.\nNesse valor estão incluídas as consultas de controle de ovulação, a coleta de óvulos com anestesia, a coleta do sêmen, a fertilização do óvulo com o sêmen para formação dos embriões e o congelamento dos embriões.\nAs medicações são cobradas separadamente por dia de uso, no valor de R$ 360,00 por dia (dose de 225ui). Em média, são utilizados cerca de 10 dias.\nQuando ocorrer, a transferência do embrião tem o valor de R$ 3.000,00 e já inclui as consultas de preparo do endométrio.\nOs valores informados são para pagamento à vista, podendo ser parcelados em até 12x, com juros de 2% ao mês.\nLembramos que o tratamento é individualizado, por isso é importante a realização de uma avaliação para uma confirmação mais precisa dos valores.\nO valor da consulta é de R$ 250,00 com pagamento antecipado ou R$ 300,00 no dia, com direito a um retorno.",
    },
    {
        id: "12m-48",
        command: "/12m",
        text: "O valor da FIV é de R$ 12.000,00.\nNesse valor estão incluídas as consultas de controle de ovulação, a coleta de óvulos com anestesia, a coleta do sêmen, a fertilização do óvulo com o sêmen para formação dos embriões e o congelamento dos embriões.\nAs medicações são cobradas separadamente por dia de uso, no valor de R$ 360,00 por dia (dose de 225ui). Em média, são utilizados cerca de 10 dias.\nQuando ocorrer, a transferência do embrião tem o valor de R$ 3.000,00 e já inclui as consultas de preparo do endométrio.\nOs valores informados são para pagamento à vista, podendo ser parcelados em até 12x, com juros de 2% ao mês.\nLembramos que o tratamento é individualizado, por isso é importante a realização de uma avaliação para uma confirmação mais precisa dos valores.\nO valor da consulta é de R$ 250,00 com pagamento antecipado ou R$ 300,00 no dia, com direito a um retorno.",
    },
    {
        id: "234-49",
        command: "/234",
        text: "Os valores informados são para pagamento à vista, podendo ser parcelados em até 12x, com juros de 2% ao mês.\nNo boleto ou PIX, é possível parcelar em até 12x sem juros, porém o tratamento é iniciado após o pagamento de algumas parcelas, normalmente a partir da oitava. Também é possível dar uma entrada ou pagar parte no cartão para iniciar antes. Nossa equipe de orçamento busca sempre se ajustar à necessidade do casal.",
    },
    {
        id: "doar-50",
        command: "/doar",
        text: "Com (30 anos) você poderia fazer um ciclo de doação de óvulos  (para mulheres que estão aguardando na fila como receptoras) e obter um abatimento de 3 mil reais no seu tratamento. Para doar é preciso estar saudável e ter entre 18 e 35 anos. Além de realizar um ato de amor, você pode obter um abatimento.",
    },
    {
        id: "345-51",
        command: "/345",
        text: "A partir de 35 anos as chances começam a diminuir mais rapidamente.",
    },
    {
        id: "43a-52",
        command: "/43a",
        text: "Com 43 anos, se não existirem fatores de infertilidade e formar-se um embrião as chances são em torno de 20-30% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir pra uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "456-53",
        command: "/456",
        text: "43-44 anos já costuma ser o limite da idade de recomendação de uma FIV. Dependeria de uma avaliação médica e de você entender as chances com os óvulos dessa idade.",
    },
    {
        id: "limite-54",
        command: "/limite",
        text: "43-44 anos já costuma ser o limite da idade de recomendação de uma FIV. Dependeria de uma avaliação médica e de você entender as chances com os óvulos dessa idade.",
    },
    {
        id: "567-55",
        command: "/567",
        text: "Para mulheres que fizeram laqueadura e a idade é superior a 44-45 anos normalmente a recomendação é a ovodoação, onde se utilizam óvulos doados de uma mulher com até 35 anos de idade e com as características físicas (altura, cor dos olhos, cor da pele) que você escolher.  Fertilizamos esses óvulos com o sêmen de seu parceiro e é formado um embrião que vai ser introduzido diretamente no seu útero.",
    },
    {
        id: "acima-56",
        command: "/acima",
        text: "Para mulheres que fizeram laqueadura e a idade é superior a 44-45 anos normalmente a recomendação é a ovodoação, onde se utilizam óvulos doados de uma mulher com até 35 anos de idade e com as características físicas (altura, cor dos olhos, cor da pele) que você escolher.  Fertilizamos esses óvulos com o sêmen de seu parceiro e é formado um embrião que vai ser introduzido diretamente no seu útero.",
    },
    {
        id: "789-57",
        command: "/789",
        text: "As chances na ovodoação são bem maiores, em torno de 60-65%",
    },
    {
        id: "678-58",
        command: "/678",
        text: "O tratamento de ovodoação tem o valor de 26 mil reais e existem diversas formas de pagamento e parcelamento possíveis.",
    },
    {
        id: "ovod-59",
        command: "/ovod",
        text: "O tratamento de ovodoação tem o valor de 26 mil reais e existem diversas formas de pagamento e parcelamento possíveis.",
    },
    {
        id: "bol-60",
        command: "/Bol",
        text: "Os valores informados são para pagamento à vista, podendo ser parcelados em até 12x, com juros de 2% ao mês.\nNo boleto ou PIX, é possível parcelar em até 12x sem juros, porém o tratamento é iniciado após o pagamento de algumas parcelas, normalmente a partir da oitava. Também é possível dar uma entrada ou pagar parte no cartão para iniciar antes. Nossa equipe de orçamento busca sempre se ajustar à necessidade do casal.\nTemos uma equipe de orçamento que busca sempre se ajustar à necessidade do casal.",
    },
    {
        id: "50a-61",
        command: "/50a",
        text: "De um  modo geral realizamos tratamentos em pacientes até 50 anos. Acima dessa idade pode ser possível, porém precisaria de uma avaliação de um cardiologista e outra avaliação de um obstetra.",
    },
    {
        id: "sol-62",
        command: "/sol",
        text: "A solução mais adequada é a fertilização in vitro (FIV)",
    },
    {
        id: "40a-63",
        command: "/40a",
        text: "Com 40 anos, se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 30-40% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir pra uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "65a-64",
        command: "/65a",
        text: "As chances na ovodoação são bem maiores, em torno de 65-70%",
    },
    {
        id: "38a-65",
        command: "/38a",
        text: "Com 38 anos, se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 40-50% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir pra uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "39a-66",
        command: "/39a",
        text: "Com 39 anos, se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 40% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir pra uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "37a-67",
        command: "/37a",
        text: "Com 37 anos, se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 50% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir pra uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "42a-68",
        command: "/42a",
        text: "Com 42 anos, se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 20-30% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir pra uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "41a-69",
        command: "/41a",
        text: "Com 41 anos, se não existirem fatores de infertilidade e formar-se um embrião, as chances são em torno de 30-40% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir pra uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "60-70",
        command: "/60%",
        text: "Se não existirem fatores de infertilidade as chances são em torno de 60% na primeira tentativa.  Porém, com mais óvulos coletados pode-se formar mais embriões e aí ir pra uma segunda tentativa por um valor muito menos custoso, fazendo-se só a transferência  de embriões.",
    },
    {
        id: "zxc-71",
        command: "/zxc",
        text: "Olá, a Engravida é uma clínica de reprodução humana assistida onde você pode investigar as causas da infertilidade e utilizar as técnicas para possibilitar ou aumentar as chances de gravidez em casos como:\n\n👉 Laqueadura;\n👉 Síndrome dos ovários policísticos (SOP);\n👉 Endometriose/adenomiose;\n👉 Miomas/cistos;\n👉 Menopausa/menopausa precoce\n👉 Congelamento de óvulos, sêmen e embriões;\n👉 Ovodoação/Embriodoação;\n👉 Fatores masculinos;\n👉 Casais homoafetivos;\n👉 Produção independente (Homem ou Mulher).",
    },
    {
        id: "sdf-72",
        command: "/sdf",
        text: "Investigamos a causa da infertilidade e indicamos a medicação ou o tratamento mais adequado para cada caso.",
    },
    {
        id: "invest-73",
        command: "/invest",
        text: "Investigamos a causa da infertilidade e indicamos a medicação ou o tratamento mais adequado para cada caso.",
    },
    {
        id: "wer-74",
        command: "/wer",
        text: "O valor da consulta para o casal é de 300 reais no dia (ou 250 reais para pagamento adiantado) e dá direito a um retorno em até 90 dias. Pode ser presencial ou online.",
    },
    {
        id: "cam-75",
        command: "/Cam",
        text: "Em Campinas ficamos na Rua Barão de Atibaia, 200 - Vila Itapura",
    },
    {
        id: "bh-76",
        command: "/BH",
        text: "Em Belo Horizonte ficamos na Av. do Contorno, 4461 - Funcionários, Belo Horizonte - MG, Brasil CEP: 30110-032",
    },
    {
        id: "es-77",
        command: "/ES",
        text: "Em Vitória ficamos na Av. Paulino Muller, 87 - B - Ilha de Santa Maria. **Atrás da Receita Federal, próximo à beira mar.**",
    },
    {
        id: "vas1-78",
        command: "/vas1",
        text: "Homens que realizaram o procedimento de vasectomia podem ter filhos. Basicamente existem dois métodos para isso: reverter a vasectomia ou realizar o tratamento de Fertilização in Vitro (FIV)",
    },
    {
        id: "vas2-79",
        command: "/vas2",
        text: "A reversão da vasectomia, que consiste no religamento dos canais deferentes de forma a permitir a passagem do espermatozoide novamente, apresenta melhores resultados quando feita há menos de 10 anos.",
    },
    {
        id: "vas3-80",
        command: "/vas3",
        text: "Já no método de Fertilização in Vitro (FIV) os espermatozoides são capturados por meio de uma punção e são fertilizados com os óvulos da mulher formando um embrião, que será introduzido diretamente no útero.",
    },
    {
        id: "vas4-81",
        command: "/vas4",
        text: "A decisão depende também da sua idade... se tiver menos de 35 anos a reversão pode ser o melhor caminho. Se tiver mais de 35 anos, a FIV costuma ser o indicado.",
    },
    {
        id: "vas5-82",
        command: "/vas5",
        text: "Qual seria o caso de vocês?",
    },
    {
        id: "revers-83",
        command: "/revers",
        text: "A reversão de vasectomia é indicada, geralmente, para restaurar a fertilidade masculina. O mais recomendado, no entanto, é que não tenham se passado mais de cinco anos da cirurgia e que a parceira não tenha mais do que 35 anos.",
    },
    {
        id: "haq-84",
        command: "/haq",
        text: "Há quanto tempo ele realizou a vasectomia?",
    },
    {
        id: "fivasec-85",
        command: "/Fivasec",
        text: "O valor da FIV é de R$ 12.000,00.\nNesse valor estão incluídas as consultas de controle de ovulação, a coleta de óvulos com anestesia, a fertilização do óvulo com o sêmen para formação dos embriões e o congelamento dos embriões.\nAs medicações são cobradas separadamente por dia de uso, no valor de R$ 360,00 por dia (dose de 225ui). Em média, são utilizados cerca de 10 dias.\nO valor da punção para a coleta dos espermatozoides é de R$ 4.300,00.\nQuando ocorre, a transferência do embrião tem o valor de R$ 3.000,00.\nSomando todas as etapas, o tratamento fica em torno de R$ 23.000,00.\nOs valores informados são para pagamento à vista, podendo ser parcelados em até 12x, com juros de 2% ao mês.\nNo boleto ou PIX, é possível parcelar em até 12x sem juros, porém o tratamento é iniciado após o pagamento de algumas parcelas, normalmente a partir da oitava. Também é possível dar uma entrada ou pagar parte no cartão para iniciar antes. Nossa equipe de orçamento busca sempre se ajustar à necessidade.",
    },
    {
        id: "congg-86",
        command: "/congg",
        text: "O valor do congelamento de óvulos é de R$ 10.000,00 à vista ou em até 12x com juros de 2% ao mês.\nNesse valor estão incluídas as consultas de controle de ovulação, a coleta dos óvulos com anestesia, o congelamento dos óvulos, 2 hastes de armazenamento e a primeira anuidade.\nAs medicações são cobradas separadamente por dia de uso, no valor de R$ 360,00 por dia (dose de 225ui). Em média, são utilizados cerca de 10 dias.\nO valor das próximas anuidades é de R$ 1.500,00.",
    },
    {
        id: "ddd-87",
        command: "/ddd",
        text: "Pode-se congelar óvulos com qualquer idade, porém o ideal é que seja realizado antes dos 35 anos. Após essa idade, é possível que a coleta do número de óvulos saudáveis seja menor.\nO valor da consulta é de R$ 250,00 com pagamento antecipado ou R$ 300,00 no dia, com direito a um retorno.",
    },
    {
        id: "fff-88",
        command: "/fff",
        text: "Não há limite de tempo para que os óvulos sejam mantidos congelados. Com a técnica atual de congelamento, chamada de vitrificação, eles podem ser mantidos por muitos anos ou até décadas até serem usados. Quanto ao número de óvulos, a ideia sempre é congelar o maior número possível. Todos os óvulos maduros podem ser congelados. Estão incluídas no congelamento 2 palhetas, que comportam 4 a 5 óvulos cada. Se for necessário, cada palheta adicional tem o valor de 400 reais.",
    },
    {
        id: "ggg-89",
        command: "/ggg",
        text: "Se desejar seguir, o primeiro passo seria o agendamento de uma consulta. O valor da consulta para avaliação é de 300 reais no dia (ou 250 reais para pagamento adiantado) e dá direito a um retorno em até 90 dias. Pode ser presencial ou online.",
    },
    {
        id: "obri-90",
        command: "/obri",
        text: "Até a coleta de óvulos, apenas não estão incluídos a consulta e alguns exames obrigatórios (HIV, hepatite, etc) que podem usar o convênio caso possuam ou fazer no laboratório da preferência de vocês.",
    },
    {
        id: "hiv-91",
        command: "/HIV",
        text: "Até a coleta de óvulos, apenas não estão incluídos a consulta e alguns exames obrigatórios (HIV, hepatite, etc) que podem usar o convênio caso possuam ou fazer no laboratório da preferência de vocês.",
    },
    {
        id: "transp-92",
        command: "/transp",
        text: "Se congelar óvulos conosco é possível trazer o material congelado da outra clinica para a Engravida (pagaria apenas o transporte). Nesse caso você pagaria apenas uma anuidade.",
    },
    {
        id: "prox-93",
        command: "/prox",
        text: "Se desejarem seguir, o próximo passo seria agendar uma consulta, presencial ou online.",
    },
    {
        id: "todas-94",
        command: "/todas",
        text: "Todas as informações que respondemos por mensagens já foram enviadas.",
    },
    {
        id: "essa-95",
        command: "/essa",
        text: "Essa pergunta já foi respondida.",
    },
    {
        id: "tecnica-96",
        command: "/tecnica",
        text: "Isso depende de vários fatores. Essas dúvidas mais técnicas é ideal que tirem com o especialista em uma consulta.",
    },
    {
        id: "anonimo-97",
        command: "/anonimo",
        text: "Precisaria ter um parentesco de até quarto grau (primo).  Do contrário precisa ser um doador anônimo.",
    },
    {
        id: "convenio-98",
        command: "/convênio",
        text: "Infelizmente os planos de saúde não cobrem tratamentos de fertilidade. Mas podem sim utilizar o plano para a realização dos exames necessários. O valor de nossa consulta é de 300 reais para pagamento no dia ou 250 reais para pagamento antecipado.",
    },
    {
        id: "garant-99",
        command: "/garant",
        text: "Podemos lhe garantir o melhor tratamento, mas infelizmente é impossível garantir um resultado positivo.",
    },
    {
        id: "12-a-15-100",
        command: "/12 a 15",
        text: "O ciclo, desde o estímulo ovariano até a coleta dos óvulos leva de 12 a 15 dias (são 3 consultas de controle com ultrassom e por último a coleta). Depois de um mês precisa de mais 5 a 7 dias para fazer 2 ultrassons de controle até a transferência do embrião.",
    },
    {
        id: "doacao-101",
        command: "/doacao",
        text: "O ciclo para doação, desde o estímulo ovariano até a coleta dos óvulos leva de 12 a 15 dias (são 3 consultas de controle com ultrassom e por último a coleta).",
    },
    {
        id: "sop-102",
        command: "/sop",
        text: "Existem algumas alternativas de tratamento para casos de síndrome dos ovários policísticos (SOP).",
    },
    {
        id: "iiu-103",
        command: "/iiu",
        text: "O valor da inseminação intrauterina é 5400 reais.",
    },
    {
        id: "semiiu-104",
        command: "/semiiu",
        text: "O sêmen de nosso banco de doadores para a  inseminação intrauterina tem o valor de 5000 reais.",
    },
    {
        id: "nao-105",
        command: "/nao",
        text: "Não realizamos esse procedimento. Para casos de mulheres que realizaram laqueadura e que desejam engravidar a solução adequada é a fertilização in vitro.",
    },
    {
        id: "linkedin-106",
        command: "/Linkedin",
        text: "Olá, siga nossa página no Linkedin. Frequentemente postamos por ali oportunidades de emprego e parcerias! Boa sorte!",
    },
    {
        id: "ong-107",
        command: "/ONG",
        text: "Se vocês não têm condição nesse momento, existe uma ONG que ajuda a colocar na fila do SUS que poderia prover esse tratamento de graça. Tente entrar em contato com eles: https://www.instagram.com/gestarong/",
    },
    {
        id: "anvisa-108",
        command: "/anvisa",
        text: "Precisam escolher qual dos óvulos vai fertilizar e transferir apenas de uma de vocês, por uma determinação da Anvisa, por motivos de segurança e rastreabilidade.",
    },
    {
        id: "paren-109",
        command: "/paren",
        text: "Ele possui algum grau de parentesco com vocês?",
    },
    {
        id: "sex-110",
        command: "/sex",
        text: "A biópsia de embrião com intuito exclusivo de escolha de sexo não é permitida no Brasil. Se existir a indicação de se fazer a biópsia por algum risco genético nesse caso se consegue saber o sexo do bebê, porém para que sejam transferidos o critério deve ser o melhor embrião, independente do sexo. Se existirem embriões de qualidade dos 2 sexos, aí podem, sim, escolher qual transferir.",
    },
    {
        id: "histe1-111",
        command: "/histe1",
        text: "Infelizmente a histerectomia inviabiliza a gestação, mas você poderia recorrer a uma barriga solidária.",
    },
    {
        id: "histe2-112",
        command: "/histe2",
        text: "No Brasil, a barriga de aluguel é chamada de útero por substituição ou barriga solidária e o processo ocorre da seguinte forma: uma mulher que, comprovadamente, não pode engravidar busca auxílio de outra que aceite que o bebê se desenvolva em seu ventre. Esse recurso é chamado de cessão uterina temporária, pois o útero de uma mulher é cedido à outra pelo tempo que durar a gestação.  A mulher que aceitar colaborar deve ser parente de até quarto grau da pessoa que precisa de ajuda para ter um bebê (ou seja, tem de ser mãe, irmã, tia, avó ou prima). Além disso, ela deve ser saudável o suficiente para que a gestação não seja um risco para ela ou para a criança.  E o mais importante! A iniciativa deve ser voluntária e solidária, sem nenhum caráter lucrativo ou comercial, de forma que nenhuma mulher pode ser paga para aceitar que seu útero seja usado em substituição ao de quem tem dificuldade para abrigar um bebê no próprio ventre. Caso essa transação seja feita, o processo torna-se ilegal.",
    },
    {
        id: "whats-113",
        command: "/whats",
        text: "Utilizamos o Whatsapp para agendamento de consultas, mas pode tirar suas dúvidas por aqui!",
    },
    {
        id: "excedentes-114",
        command: "/excedentes",
        text: "Se existirem embriões excedentes a nova tentativa tem o valor de 3.000 reais.",
    },
    {
        id: "incluido-115",
        command: "/incluido",
        text: "Nesse valor da FIV já estão incluídas as consultas de controle de ovulação, os medicamentos de estímulo ovariano (225ui/dia), a coleta de óvulos com anestesia, a coleta do sêmen, o congelamento dos embriões, as consultas de preparo de endométrio e a transferência de embrião.",
    },
    {
        id: "exc2-116",
        command: "/exc2",
        text: "Se existirem embriões excedentes e precisarem de um nova tentativa ou decidirem ter outro filho no futuro o valor é 3000 reais.",
    },
    {
        id: "gemeos-117",
        command: "/gemeos",
        text: "Se fizer a transferência de apenas um embrião, as chances de gêmeos são as mesmas que em uma gravidez espontânea.",
    },
    {
        id: "depen-118",
        command: "/depen",
        text: "Dependendo da idade vocês poderiam fazer um ciclo de doação de óvulos (para mulheres que estão aguardando na fila como receptoras) e obterem um abatimento de 3 mil reais no tratamento de vocês (por cada uma que doar). Para doar é preciso estar saudável e ter entre 18 e 35 anos. Além de realizar um ato de amor, vocês podem obter um abatimento.",
    },
    {
        id: "causas-119",
        command: "/causas",
        text: "Investigamos as causas e indicamos a medicação ou o tratamento mais adequado para cada caso.",
    },
    {
        id: "rsp-120",
        command: "/rsp",
        text: "O valor estimado da Relação Sexual Programada é de R$ 3.200,00.",
    },
    {
        id: "custo-121",
        command: "/custo",
        text: "Você segue o caminho normal do seu tratamento e a parte da doação não tem custo algum. Você recebe ainda um abatimento de 3 mil reais no seu tratamento.",
    },
    {
        id: "naconsulta-122",
        command: "/naconsulta",
        text: "Na consulta fazemos uma avaliação do casal, solicitamos os exames necessários para trazerem no retorno (retorno não tem custo), os médicos explicam o tratamento e tiram as dúvidas de vocês.",
    },
    {
        id: "doacao-123",
        command: "/doação",
        text: "O ciclo para doação, desde o estímulo ovariano até a coleta dos óvulos leva de 12 a 15 dias (são 3 consultas de controle com ultrassom e por último a coleta).",
    },
    {
        id: "meno-124",
        command: "/meno",
        text: "Nesse caso normalmente a recomendação é a ovodoação, onde se utilizam óvulos doados de uma mulher com até 33 anos de idade e com as características físicas (altura, cor dos olhos, cor da pele) que você escolher.  Fertilizamos esses óvulos com o sêmen de seu parceiro e é formado um embrião que vai ser introduzido diretamente no seu útero.",
    },
    {
        id: "ovo-125",
        command: "/ovo",
        text: "O tratamento de ovodoação tem o valor de 26 mil reais e existem diversas formas de pagamento e parcelamento possíveis.",
    },
    {
        id: "boleto-126",
        command: "/boleto",
        text: "Os valores informados são para pagamento à vista, podendo ser parcelados em até 12x, com juros de 2% ao mês.\nNo boleto ou PIX, é possível parcelar em até 12x sem juros, porém o tratamento é iniciado após o pagamento de algumas parcelas, normalmente a partir da oitava. Também é possível dar uma entrada ou pagar parte no cartão para iniciar antes. Nossa equipe de orçamento busca sempre se ajustar à necessidade do casal.\nTemos uma equipe de orçamento que busca sempre se ajustar à necessidade do casal.",
    },
    {
        id: "disp-127",
        command: "/disp",
        text: "Estamos à disposição!",
    },
    {
        id: "duv-128",
        command: "/duv",
        text: "Olá, qual seria a sua dúvida?",
    },
    {
        id: "fim-129",
        command: "/fim",
        text: "Se tiver alguma dúvida é só nos chamar por aqui!",
    },
    {
        id: "qual-130",
        command: "/qual",
        text: "Qual seria a causa da infertilidade ou o motivo do tratamento?",
    },
    {
        id: "online-131",
        command: "/online",
        text: "Realizamos a primeira consulta online se desejar!",
    },
    {
        id: "apartir-132",
        command: "/apartir",
        text: "A partir dos 35 anos as chances começam a diminuir mais rapidamente.",
    },
    {
        id: "time-133",
        command: "/time",
        text: "Nosso time de relacionamento vai responder na segunda-feira para encontrarem juntos o melhor dia e horário. Qualquer dúvida estamos à disposição!",
    },
    {
        id: "tiver35-134",
        command: "/tiver35",
        text: "Se você tiver menos de 35 anos e tentando engravidar há mais de um ano ou se tem mais de 35 e está tentando engravidar há mais de 6 meses já existe um diagnóstico de infertilidade e é recomendada uma investigação das causas.",
    },
    {
        id: "seguir-135",
        command: "/seguir",
        text: "Se desejarem seguir, o primeiro passo seria agendar uma consulta, presencial ou online.",
    },
    {
        id: "exames-136",
        command: "/exames",
        text: "Apenas não estão incluídos a consulta e alguns exames como  espermograma do seu parceiro e alguns obrigatórios (HIV, hepatite, etc) que podem usar o convênio caso possuam ou fazer no laboratório da preferência de vocês. Normalmente esses exames iniciais custam todos em torno de 800 reais para o casal.",
    },
    {
        id: "gos-137",
        command: "/gos",
        text: "Gostaria de agendar uma consulta?",
    },
    {
        id: "rap-138",
        command: "/rap",
        text: "Se desejarem seguir, quanto mais rápido decidirem, maiores as chances.",
    },
    {
        id: "jac-139",
        command: "/jac",
        text: "Já conhecem a causa da infertilidade ou a necessidade de algum tratamento?",
    },
    {
        id: "nesse-140",
        command: "/nesse",
        text: "Nesse caso a indicação é uma fertilização in vitro com uma punção para a coleta de espermatozoides.",
    },
    {
        id: "enc-141",
        command: "/enc",
        text: "Existe alguma dúvida? Do contrário encerraremos a conversa.",
    },
    {
        id: "mutir-142",
        command: "/mutir",
        text: "O mutirão foi criado quando conseguimos juntar várias pacientes no mesmo mês e pudemos propiciar um preço mais acessível. A procura foi grande e conseguimos manter  a campanha.",
    },
    {
        id: "prod-143",
        command: "/prod",
        text: "Para uma produção independente, a solução é a realização de uma FIV com sêmen de doador.\nO valor da FIV é de R$ 12.000,00.\nNesse valor estão incluídas as consultas de controle de ovulação, a coleta de óvulos com anestesia, a fertilização do óvulo com o sêmen para formação dos embriões e o congelamento dos embriões.\nAs medicações são cobradas separadamente por dia de uso, no valor de R$ 360,00 por dia (dose de 225ui). Em média, são utilizados cerca de 10 dias.\nQuando ocorre, a transferência do embrião tem o valor de R$ 3.000,00 e já inclui as consultas de preparo do endométrio.\nO valor do sêmen do doador é de R$ 4.000,00.\nSomando todas as etapas, o tratamento fica em torno de R$ 23.000,00.\nOs valores informados são para pagamento à vista, podendo ser parcelados em até 12x, com juros de 2% ao mês.\nReforçamos que o tratamento é individualizado, por isso é importante avaliar com um médico.\nO valor da consulta é de R$ 250,00 com pagamento antecipado ou R$ 300,00 no dia, incluso um retorno.",
    },
    {
        id: "jap-144",
        command: "/jap",
        text: "Já passaram em uma consulta com um médico especialista em reprodução humana?",
    },
    {
        id: "blog-145",
        command: "/blog",
        text: "Olá, para tirar dúvidas sobre reprodução assistida acesse nosso blog! https://www.engravida.com.br/blog/",
    },
    {
        id: "prontos-146",
        command: "/prontos",
        text: "Quando estiverem prontos, o primeiro passo seria agendar uma consulta, presencial ou online.",
    },
    {
        id: "medicos-147",
        command: "/MEDICOS",
        text: "No Rio\nhttps://www.instagram.com/dra_jessicareis/\nhttps://www.instagram.com/daphusiglio/\nhttps://www.instagram.com/dr.marcossanches\n\nSalvador\nhttps://www.instagram.com/dra.amandacutalo/\nhttps://www.instagram.com/joyjoventinaaraujo/\n\nBrasília\nhttps://www.instagram.com/siqueiramayane/\nhttps://www.instagram.com/dra.larissa.barbosa/\n\nSão  Paulo\nhttps://www.instagram.com/dracarolfujimoto/\nhttps://www.instagram.com/drabarbara.tavares/\nhttps://www.instagram.com/dralauraleber/\n\nCampinas\nhttps://www.instagram.com/drfabiopadilla/\n\nManaus\nhttps://www.instagram.com/pamelagineco/\n\nVitória\nhttps://www.instagram.com/drabrunafertileuta\nhttps://www.instagram.com/brendabattestin",
    },
    {
        id: "gen-148",
        command: "/gen",
        text: "A genética será da dona dos  óvulos e a epigenética  da que realizar a gestação.",
    },
    {
        id: "epi-149",
        command: "/epi",
        text: "Por favor leia esse texto sobre epigenética: https://ipgo.com.br/doacao-e-recepcao-de-ovulos-a-epigenetica-o-efeito-nas-receptoras-de-ovulos/",
    },
    {
        id: "curriculo-150",
        command: "/curriculo",
        text: "Olá, tudo bem? Para enviar seu currículo, pedimos que entre no link a seguir: https://www.engravida.com.br/trabalhe-conosco/ e cadastre-se. 😃 Boa sorte!",
    },
    {
        id: "ajud-151",
        command: "/ajud",
        text: "Como posso te ajudar?",
    },
    {
        id: "gineco-152",
        command: "/gineco",
        text: "Recomendamos que procure um médico ginecologista.",
    },
    {
        id: "doador-153",
        command: "/doador",
        text: "Olá, obrigado por seu interesse e disposição. Para se tornar um doador, clique no link a seguir e preencha o formulário: https://bit.ly/3gGYPDF 🙂",
    },
    {
        id: "des-154",
        command: "/des",
        text: "Desculpe a demora pela resposta, a mensagem ficou na caixa de spam.",
    },
    {
        id: "biopsia-155",
        command: "/biopsia",
        text: "A biópsia tem o valor de 2500 reais por embrião",
    },
    {
        id: "puncao-156",
        command: "/puncao",
        text: "O valor da punção para a coleta de espermatozoides é de 4.300 reais.",
    },
    {
        id: "exameh-157",
        command: "/exameh",
        text: "Para o homem\n- Espermograma -\n- HIV 1 e 2 -\n- HTLV 1 e 2 -\n- VDRL -\n- HbSAg -\n- Anti-HbC IgM e IgG -\n- Anti-HCV -",
    },
    {
        id: "examem-158",
        command: "/examem",
        text: "Para a Mulher -\nHemograma completo\n- TSH -\n- HIV 1 E 2 -\n- VDRL -\n- HbSAg -\n- Anti-HbC IgM e IgG -\n- Anti-HCV -",
    },
    {
        id: "chances-159",
        command: "/chances",
        text: "As chances dependem, entre outros fatores, da idade e qualidade dos óvulos.",
    },
    {
        id: "ntentativas-160",
        command: "/ntentativas",
        text: "Existe um instituto chamado N.Tentativas que tem um lindo projeto e ajuda algumas mulheres que não podem pagar por um tratamento. Você pode se cadastrar no link a seguir e aguardar...\nhttps://docs.google.com/forms/d/e/1FAIpQLSf5VIxSKvKj3vyaINPKqanHgWVxbp9H86hLMyvD2LxhTXsflw/viewform?usp=send_form\nBoa sorte!",
    },
    {
        id: "embrio-161",
        command: "/embrio",
        text: "O tratamento de embriodoação tem o valor de 22.200 reais e existem diversas formas de pagamento e parcelamento possíveis.",
    },
    {
        id: "abat-162",
        command: "/abat",
        text: "Com 30 anos é possível sim. Se tivermos alguma receptora com suas características para doar seus óvulos, você pode fazer um  ciclo para doação e teria um abatimento de 3 mil reais no tratamento.",
    },
    {
        id: "eng-163",
        command: "/eng",
        text: "A Engravida existe há mais de 15 anos e já tivemos mais de 6 mil bebês nascidos! Temos unidades hoje em São Paulo (SP), Campinas (SP), Bauru (SP), Juiz de Fora (MG), Belo Horizonte (MG), Rio de Janeiro (RJ), Salvador (BA), Brasília (DF), Manaus (AM) e Vitória (ES). Essa é uma de nossas unidades - https://www.instagram.com/p/C4sywtqOEL9/",
    },
    {
        id: "reclame-164",
        command: "/reclame",
        text: "A Engravida é uma clínica que existe há mais de 15 anos com milhares de resultados positivos e bebês nascidos. Infelizmente é impossível garantir um resultado positivo, mas podemos sim lhe garantir o melhor tratamento. Todas as reclamações são respondidas e resolvidas. Estamos à disposição caso deseje agendar uma visita conosco.",
    },
    {
        id: "fgts-165",
        command: "/fgts",
        text: "Já tivemos diversas pacientes que conseguiram, mas, como não está previsto em lei, o uso do FGTS para tratamentos de reprodução humana assistida, é necessário recorrer à Justiça para conseguir a liberação do saldo no fundo, uma vez que a Caixa Econômica costuma se recusar a liberar os valores do FGTS para este fim. Você precisaria de algum advogado para entrar com o pedido na justiça.",
    },
    {
        id: "processo-166",
        command: "/processo",
        text: "Se você aceitar fazer o processo de doação faria a primeira parte (consultas de controle de ovulação, os medicamentos de estímulo ovariano (225ui/dia), a coleta de óvulos com anestesia) e esses óvulos seriam doados. No ciclo seguinte (menstruação seguinte) vocês iniciaram o ciclo de vocês.",
    },
    {
        id: "nob-167",
        command: "/nob",
        text: "No Brasil é proibido comprar ou vender tecidos, órgãos ou partes do corpo humano. A doação precisaria ser voluntária.",
    },
    {
        id: "opaiiu-168",
        command: "/opaiiu",
        text: "Se a indicação for a inseminação intrauterina o valor é 5.400 reais e nesse caso o sêmen tem o valor  de 5.000 reais totalizando 10.400 reais.",
    },
    {
        id: "exp-169",
        command: "/exp",
        text: "O médico especialista fará uma avaliação, explicará o procedimento e solicitará os exames necessários.",
    },
    {
        id: "cidade-170",
        command: "/cidade",
        text: "Na consulta fazemos uma avaliação do casal, solicitamos os exames necessários para apresentarem no retorno (retorno não tem custo), os médicos explicam o tratamento e tiram as dúvidas de vocês. Podem fazer os exames na cidade de vocês.",
    },
    {
        id: "probl-171",
        command: "/probl",
        text: "Se tiver algum problema por favor adicione nosso whatsapp nacional de agendamento de consultas e envie uma mensagem. 11- 94918-0394",
    },
    {
        id: "whatsapp-172",
        command: "/Whatsapp",
        text: "Para entrar em contato conosco através do whatsapp acesse o link: http://wa.me/5511949180394",
    },
    {
        id: "blasto-173",
        command: "/blasto",
        text: "Sim, todos maduros. E se não existir fator masculino, garantimos ao menos um embrião (blastocisto). Se não tiver ao menos um blastocisto tentaremos com outros óvulos, de outra doadora que vocês escolherem, sem custo. Mas é muito raro não fertilizar, os óvulos são de mulheres de menos de 33 anos e que passaram por uma criteriosa análise.",
    },
    {
        id: "versus-174",
        command: "/versus",
        text: "Ambas as técnicas têm vantagens e desvantagens.\nNa inseminação é inserido o sêmen de doador em uma de vocês durante o período de ovulação.  As chances são menores, porém é menos  invasivo e o valor é um pouco menor.\nNa FIV as duas participam do processo; coletamos os óvulos de uma, fertilizamos com o sêmen do  doador e inserimos o embrião já formado no útero da outra.\nNo caso da FIV podem ainda doar óvulos.",
    },
    {
        id: "dois-175",
        command: "/dois",
        text: "Ideal é que os dois possam ir, mas se ele não puder solicitamos alguns exames para ele realizar.",
    },
    {
        id: "aide-176",
        command: "/aide",
        text: "A ideia seria utilizar os óvulos de uma e a outra realizar a gestação?",
    },
    {
        id: "descong-177",
        command: "/descong",
        text: "Quando decidir engravidar, descongelaremos seus óvulos, fertilizaremos com o sêmen do seu parceiro formando embriões. Esse processo com a transferência do embrião para o seu útero teria hoje o valor de 5700 reais  e poderia  ser dividido em até 12x, com juros de 2% ao mês.",
    },
    {
        id: "90dias-178",
        command: "/90dias",
        text: "O tempo depende do perfil escolhido, mas normalmente tentamos conseguir os óvulos em até 90 dias.",
    },
    {
        id: "ovodoacao-179",
        command: "/ovodoação",
        text: "Para a maioria dos perfis de ovodoação, não há fila de espera. No entanto, dependendo das características desejadas e do tipo sanguíneo, o prazo pode variar, levando de alguns dias a até alguns meses em casos específicos.",
    },
    {
        id: "venda-180",
        command: "/venda",
        text: "A doação precisaria ser voluntária ou durante o tratamento. É proibida a venda de óvulos no Brasil.",
    },
    {
        id: "doenca-181",
        command: "/doença",
        text: "Seriam condições físicas e mentais debilitantes, doenças graves (esclerose múltipla, hepatite, neoplasias), alterações genéticas, doenças psicológicas e uso de medicações (depressão), cirurgia de retirada do ovário e/ou endometrioma, câncer de origem genética-hereditária da candidata ou dos familiares e IMC acima de 30.",
    },
    {
        id: "diu-182",
        command: "/DIU",
        text: "Para mulheres que utilizam o dispositivo intrauterino (DIU), não é necessário a retirada, mesmo quando o DIU é liberador de hormônio, como o Mirena. Isso porque o hormônio liberado pelo Mirena não interfere na estimulação e desenvolvimento dos folículos",
    },
];

type ComposerElements = {
    container: HTMLElement;
    textarea: HTMLTextAreaElement;
    shortcutButton: HTMLButtonElement;
};

type MenuPosition = {
    left: number;
    bottom: number;
    width: number;
};

export default function InboxPrewrittenMessagesController({
    messageListRef,
}: {
    messageListRef: RefObject<HTMLDivElement | null>;
}) {
    const pathname = usePathname();
    const isInbox = pathname === "/inbox" || pathname.startsWith("/inbox/");

    const [composer, setComposer] = useState<ComposerElements | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [sendingMessageId, setSendingMessageId] = useState<string | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);
    const [position, setPosition] = useState<MenuPosition | null>(null);

    const popupRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<ComposerElements | null>(null);

    const filteredMessages = useMemo(() => {
        const trimmedQuery = query.trim();

        if (!trimmedQuery.startsWith("/")) {
            return PREWRITTEN_MESSAGES;
        }

        const normalizedQuery = normalize(trimmedQuery);

        return PREWRITTEN_MESSAGES.filter((message) => {
            return (
                normalize(message.command).startsWith(normalizedQuery) ||
                normalize(message.text).includes(normalizedQuery.slice(1))
            );
        });
    }, [query]);

    const sendImmediately = useCallback(async (message: PrewrittenMessage) => {
        const currentComposer = composerRef.current;

        if (
            !currentComposer ||
            currentComposer.textarea.disabled ||
            sendingMessageId
        ) {
            return;
        }

        setSendingMessageId(message.id);
        setSendError(null);
        setComposerValue(currentComposer.textarea, message.text);
        setQuery(message.text);

        const sent = await clickSendWhenReady(currentComposer.container);

        if (sent) {
            setIsOpen(false);
        } else {
            setSendError(
                "A mensagem foi aplicada, mas não foi possível acionar o envio automaticamente.",
            );
            currentComposer.textarea.focus();
        }

        setSendingMessageId(null);
    }, [sendingMessageId]);

    useEffect(() => {
        if (!isInbox) {
            composerRef.current = null;
            setComposer(null);
            setIsOpen(false);
            return;
        }

        const messageList = messageListRef.current;
        const container = messageList?.parentElement;

        if (!container) return;

        function syncComposer() {
            const textarea = container!.querySelector<HTMLTextAreaElement>(
                'textarea[placeholder="Responder como atendente..."], textarea[placeholder="Janela de 24h encerrada"]',
            );
            const shortcutButton = container!.querySelector<HTMLButtonElement>(
                'button[title="Template"], button[title="Mensagens prontas"]',
            );

            if (!textarea || !shortcutButton) {
                composerRef.current = null;
                setComposer(null);
                return;
            }

            const nextComposer = {container: container!, textarea, shortcutButton};
            composerRef.current = nextComposer;
            setComposer((current) => {
                if (
                    current?.container === nextComposer.container &&
                    current.textarea === nextComposer.textarea &&
                    current.shortcutButton === nextComposer.shortcutButton
                ) {
                    return current;
                }

                return nextComposer;
            });
            setQuery(textarea.value);
        }

        syncComposer();

        const observer = new MutationObserver(syncComposer);
        observer.observe(container, {
            attributes: true,
            attributeFilter: ["disabled", "placeholder", "title"],
            childList: true,
            subtree: true,
        });

        return () => observer.disconnect();
    }, [isInbox, messageListRef]);

    useEffect(() => {
        if (!composer) return;

        const {shortcutButton, textarea} = composer;
        const originalTitle = shortcutButton.title;
        const originalAriaLabel = shortcutButton.getAttribute("aria-label");

        shortcutButton.title = "Mensagens prontas";
        shortcutButton.setAttribute("aria-label", "Abrir mensagens prontas");

        function handleShortcutClick(event: MouseEvent) {
            event.preventDefault();
            event.stopPropagation();
            setQuery(textarea.value);
            setSendError(null);
            setIsOpen((current) => !current);
        }

        function handleTextareaInput(event: Event) {
            const inputEvent = event as InputEvent;
            const value = textarea.value;

            if (!inputEvent.isComposing) {
                const message = resolvePrewrittenMessage(value);

                if (message) {
                    setComposerValue(textarea, message.text);
                    setQuery(message.text);
                    setSendError(null);
                    setIsOpen(false);
                    textarea.focus();
                    textarea.setSelectionRange(message.text.length, message.text.length);
                    return;
                }
            }

            setQuery(value);

            if (isSlashQuery(value)) {
                setSendError(null);
                setIsOpen(true);
            }
        }

        function handleTextareaKeyDown(event: KeyboardEvent) {
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

            const message = resolvePrewrittenMessage(textarea.value);
            if (!message) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            void sendImmediately(message);
        }

        shortcutButton.addEventListener("click", handleShortcutClick, true);
        textarea.addEventListener("input", handleTextareaInput);
        textarea.addEventListener("keydown", handleTextareaKeyDown, true);

        return () => {
            shortcutButton.removeEventListener("click", handleShortcutClick, true);
            textarea.removeEventListener("input", handleTextareaInput);
            textarea.removeEventListener("keydown", handleTextareaKeyDown, true);

            if (shortcutButton.title === "Mensagens prontas") {
                shortcutButton.title = originalTitle;
            }

            if (originalAriaLabel === null) {
                shortcutButton.removeAttribute("aria-label");
            } else {
                shortcutButton.setAttribute("aria-label", originalAriaLabel);
            }
        };
    }, [composer, sendImmediately]);

    useEffect(() => {
        if (!composer) return;

        composer.shortcutButton.setAttribute("aria-expanded", String(isOpen));
        return () => composer.shortcutButton.removeAttribute("aria-expanded");
    }, [composer, isOpen]);

    useEffect(() => {
        if (!isOpen || !composer) {
            setPosition(null);
            return;
        }

        function updatePosition() {
            const rect = composer!.shortcutButton.getBoundingClientRect();
            const width = Math.min(440, Math.max(280, window.innerWidth - 32));
            const left = Math.min(
                Math.max(16, rect.right - width),
                Math.max(16, window.innerWidth - width - 16),
            );

            setPosition({
                left,
                bottom: Math.max(16, window.innerHeight - rect.top + 8),
                width,
            });
        }

        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);

        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [composer, isOpen]);

    useEffect(() => {
        if (!isOpen || !composer) return;

        function handlePointerDown(event: MouseEvent) {
            const target = event.target as Node;

            if (
                popupRef.current?.contains(target) ||
                composer!.shortcutButton.contains(target)
            ) {
                return;
            }

            setIsOpen(false);
        }

        function handleEscape(event: KeyboardEvent) {
            if (event.key === "Escape") setIsOpen(false);
        }

        document.addEventListener("mousedown", handlePointerDown);
        document.addEventListener("keydown", handleEscape);

        return () => {
            document.removeEventListener("mousedown", handlePointerDown);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [composer, isOpen]);

    function applyMessage(message: PrewrittenMessage) {
        const currentComposer = composerRef.current;
        if (!currentComposer || currentComposer.textarea.disabled) return;

        setComposerValue(currentComposer.textarea, message.text);
        setQuery(message.text);
        setSendError(null);
        setIsOpen(false);
        currentComposer.textarea.focus();
    }

    if (!isInbox || !composer || !isOpen || !position) return null;

    const menu = (
        <div
            ref={popupRef}
            role="dialog"
            aria-label="Mensagens prontas"
            className="fixed z-[100] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
            style={{left: position.left, bottom: position.bottom, width: position.width}}
        >
            <div className="max-h-[min(320px,60vh)] overflow-y-auto p-2 [scrollbar-color:#cbd5e1_transparent] [scrollbar-width:thin]">
                {filteredMessages.length > 0 ? (
                    <div className="space-y-2">
                        {filteredMessages.map((message) => {
                            const isSending = sendingMessageId === message.id;
                            const disabled = composer.textarea.disabled || !!sendingMessageId;

                            return (
                                <div
                                    key={message.id}
                                    className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 p-2 transition-colors hover:border-slate-300"
                                >
                                    <p title={message.text} className="min-w-0 flex-1 truncate text-sm text-slate-600">
                                        {message.text}
                                    </p>
                                    <code className="inline-flex shrink-0 rounded-md bg-brand-soft px-2 py-1 text-xs font-bold text-brand">
                                        {message.command}
                                    </code>
                                    <button
                                        type="button"
                                        title="Aplicar no campo"
                                        aria-label="Aplicar mensagem no campo"
                                        disabled={disabled}
                                        onClick={() => applyMessage(message)}
                                        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <PencilLine size={14}/>
                                    </button>
                                    <button
                                        type="button"
                                        title="Enviar imediatamente"
                                        aria-label="Enviar mensagem imediatamente"
                                        disabled={disabled}
                                        onClick={() => void sendImmediately(message)}
                                        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-brand text-white shadow-sm transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isSending ? (
                                            <LoaderCircle size={14} className="animate-spin"/>
                                        ) : (
                                            <Send size={14}/>
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="px-4 py-8 text-center text-sm text-slate-400">
                        Nenhum comando encontrado.
                    </div>
                )}

                {sendError ? (
                    <div className="mx-1 mt-2 rounded-lg bg-red-soft px-3 py-2 text-xs font-semibold text-red">
                        {sendError}
                    </div>
                ) : null}
            </div>
        </div>
    );

    return createPortal(menu, document.body);
}

export function resolvePrewrittenMessage(value: string) {
    const normalizedValue = normalize(value);

    return PREWRITTEN_MESSAGES.find(
        (message) => normalize(message.command) === normalizedValue,
    );
}

function isSlashQuery(value: string) {
    const trimmed = value.trim();
    return trimmed.startsWith("/") && !trimmed.includes("\n");
}

function normalize(value: string) {
    return value
        .trim()
        .toLocaleLowerCase("pt-BR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function setComposerValue(textarea: HTMLTextAreaElement, value: string) {
    const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
    )?.set;

    if (valueSetter) {
        valueSetter.call(textarea, value);
    } else {
        textarea.value = value;
    }

    textarea.dispatchEvent(new Event("input", {bubbles: true}));
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
}

function clickSendWhenReady(container: HTMLElement) {
    return new Promise<boolean>((resolve) => {
        let attempts = 0;
        const maximumAttempts = 18;

        function attemptSend() {
            const sendButton = container.querySelector<HTMLButtonElement>(
                'button[title="Enviar"]',
            );

            if (sendButton && !sendButton.disabled) {
                sendButton.click();
                resolve(true);
                return;
            }

            attempts += 1;

            if (attempts >= maximumAttempts) {
                resolve(false);
                return;
            }

            window.requestAnimationFrame(attemptSend);
        }

        window.requestAnimationFrame(attemptSend);
    });
}
