import { describe, expect, it } from 'vitest';
import {
  isMunicipalityCode,
  MUNICIPALITIES,
  municipalitiesByDistrict,
  municipalityLabel,
} from '../../src/shared/municipalities';
import {
  IndividualSignatureSchema,
  OrganizationSignatureSchema,
  signatureFormToBody,
  signatureRequestSchema,
} from '../../src/shared/schemas';

describe('municipalities', () => {
  it('has the 308 municipalities, grouped by district with the islands last', () => {
    expect(MUNICIPALITIES).toHaveLength(308);
    const groups = municipalitiesByDistrict();
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(308);
    expect(groups.slice(-2).map((g) => g.district)).toEqual([
      'Região Autónoma da Madeira',
      'Região Autónoma dos Açores',
    ]);
    expect(groups[0]?.district).toBe('Aveiro');
  });

  it('disambiguates repeated names', () => {
    expect(municipalityLabel('1312')).toBe('Porto');
    expect(municipalityLabel('0806')).toBe('Lagoa (Faro)');
    expect(municipalityLabel('4201')).toBe('Lagoa (Açores)');
  });

  it('validates codes', () => {
    expect(isMunicipalityCode('1106')).toBe(true);
    expect(isMunicipalityCode('Lisboa')).toBe(false);
  });
});

describe('signature schemas', () => {
  const base = {
    kind: 'individual',
    email: 'Ana@Exemplo.pt',
    municipality: '1312',
    consent: 'on',
  };

  it('normalises email and turns empty text into null', () => {
    const r = IndividualSignatureSchema.parse({ ...base, pseudonym: ' Gaivota ', firstName: '' });
    expect(r).toMatchObject({
      email: 'ana@exemplo.pt',
      pseudonym: 'Gaivota',
      firstName: null,
      isPublic: false,
      canContact: false,
      consent: true,
    });
  });

  it('rejects contact details in published fields, accepts ordinary text', () => {
    const issues = (activity: string) =>
      IndividualSignatureSchema.safeParse({ ...base, pseudonym: 'X', activity }).error?.issues ??
      [];
    expect(issues('professora, Braga')).toEqual([]);
    expect(issues('turma de 2025, sala 12')).toEqual([]);
    expect(issues('ana@exemplo.pt')[0]?.message).toBe('contact_in_public_field');
    expect(issues('+351 912 345 678')[0]?.message).toBe('contact_in_public_field');
  });

  it('validates phone numbers loosely', () => {
    const ok = (phone: string) =>
      IndividualSignatureSchema.safeParse({ ...base, pseudonym: 'X', phone }).success;
    expect(ok('912 345 678')).toBe(true);
    expect(ok('+351 213 456 789')).toBe(true);
    expect(ok('12345')).toBe(false);
    expect(ok('liga-me')).toBe(false);
  });

  it('normalises the organisation website', () => {
    const parse = (site: string) =>
      OrganizationSignatureSchema.safeParse({
        ...base,
        kind: 'organization',
        orgName: 'Coletivo',
        orgType: 'collective',
        contactName: 'Pessoa',
        legitimacy: true,
        isPublic: true,
        site,
      });
    expect(parse('exemplo.pt').data?.site).toBe('https://exemplo.pt/');
    expect(parse('http://exemplo.pt/x').data?.site).toBe('http://exemplo.pt/x');
    expect(parse('').data?.site).toBeNull();
    expect(parse('javascript:alert(1)').success).toBe(false);
    expect(parse('nope').success).toBe(false);
  });

  it('picks the schema by kind', () => {
    expect(signatureRequestSchema({ kind: 'organization' })).toBe(OrganizationSignatureSchema);
    expect(signatureRequestSchema({ kind: 'x' })).toBe(IndividualSignatureSchema);
    expect(signatureRequestSchema(null)).toBe(IndividualSignatureSchema);
  });

  it('maps HTML form fields (Turnstile field, files dropped)', () => {
    expect(
      signatureFormToBody({ kind: 'individual', 'cf-turnstile-response': 'tok', file: new Blob() }),
    ).toEqual({ kind: 'individual', turnstileToken: 'tok' });
    expect(signatureFormToBody({ 'cf-turnstile-response': '' })).toEqual({});
  });
});
