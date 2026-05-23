import React from 'react';
import { Cookie } from 'lucide-react';
import { LegalPageLayout, type LegalSection } from './LegalPageLayout';

const sections: LegalSection[] = [
  {
    id: 'o-que-sao',
    title: '1. O que são cookies e tecnologias semelhantes',
    body: [
      'Cookies são pequenos ficheiros armazenados no navegador para manter sessões, guardar preferências, reforçar segurança e melhorar a experiência do utilizador.',
      'Também podemos utilizar armazenamento local, tokens de sessão e tecnologias semelhantes para suportar o funcionamento do Genesis Miner.'
    ]
  },
  {
    id: 'como-usamos',
    title: '2. Como usamos cookies',
    body: [
      'Utilizamos cookies e mecanismos equivalentes para autenticação, manutenção de sessão, prevenção a fraude, segurança da conta, preferências de interface e estabilidade da aplicação.',
      'Alguns recursos podem deixar de funcionar corretamente se estes mecanismos forem bloqueados.'
    ]
  },
  {
    id: 'tipos',
    title: '3. Tipos de cookies que podem ser usados',
    body: [
      'Cookies estritamente necessários: essenciais para login, sessão, segurança e funcionamento técnico do site.',
      'Cookies funcionais: usados para lembrar preferências, tema, idioma, estado de navegação ou outras escolhas do utilizador.',
      'Cookies analíticos ou de medição: podem ser usados para entender desempenho, falhas, uso agregado e melhoria do produto, conforme configuração ativa na plataforma.'
    ]
  },
  {
    id: 'terceiros',
    title: '4. Cookies e tecnologias de terceiros',
    body: [
      'Alguns serviços externos integrados ao Genesis Miner podem definir ou ler cookies próprios, de acordo com as respetivas políticas.',
      'Esses terceiros podem incluir fornecedores de analytics, proteção, infraestrutura, mídia incorporada ou publicidade, quando aplicável.'
    ]
  },
  {
    id: 'gestao',
    title: '5. Como gerir cookies',
    body: [
      'Você pode controlar cookies pelo navegador, por extensões, por definições de sistema e, quando disponível, por mecanismos internos da plataforma.',
      'Bloquear cookies essenciais pode impedir login, persistência de sessão ou funcionalidades críticas de segurança.'
    ]
  },
  {
    id: 'alteracoes',
    title: '6. Alterações',
    body: [
      'Podemos atualizar esta política quando as tecnologias utilizadas ou os requisitos legais mudarem.'
    ]
  }
];

export const CookiesPolicyPage: React.FC = () => {
  return (
    <LegalPageLayout
      title="Política de Cookies"
      intro="Esta política descreve como o Genesis Miner utiliza cookies, armazenamento local e tecnologias semelhantes."
      updatedAt="21 de maio de 2026"
      accentClass="text-orange-700 dark:text-orange-400"
      accentHoverClass="hover:text-orange-600 dark:hover:text-orange-300"
      iconClass="text-orange-600 dark:text-orange-500"
      icon={Cookie}
      sections={sections}
    />
  );
};
