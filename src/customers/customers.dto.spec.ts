import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateCustomerDto } from './dto/create-customer.dto';

describe('CreateCustomerDto (DIAN)', () => {
  it('acepta campos DIAN opcionales y responsabilidades', async () => {
    const dto = new CreateCustomerDto();
    dto.name = 'Comercial Andina SAS';
    dto.phone = '6014557060';
    dto.documentType = 'NIT' as any;
    dto.documentNumber = '900123456';
    dto.dv = '7';
    dto.legalOrganizationCode = 1;
    dto.municipalityCode = '11001';
    dto.tributeCode = '01';
    dto.responsibilities = [{ code: 'O-13' }];
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rechaza legalOrganizationCode inválido (fuera de 1..2)', async () => {
    const dto = new CreateCustomerDto();
    dto.name = 'Cliente';
    dto.phone = '3000000000';
    dto.legalOrganizationCode = 5;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'legalOrganizationCode')).toBe(
      true,
    );
  });
});