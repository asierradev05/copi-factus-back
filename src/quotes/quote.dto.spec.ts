import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateQuoteItemDto } from './dto/quote.dto';

describe('CreateQuoteItemDto (unitPrice)', () => {
  it('acepta un valor unitario mayor a 0', async () => {
    const dto = new CreateQuoteItemDto();
    dto.description = 'Láminas adhesivas';
    dto.quantity = 10;
    dto.unitPrice = 2000;
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rechaza un valor unitario 0', async () => {
    const dto = new CreateQuoteItemDto();
    dto.description = 'Láminas adhesivas';
    dto.quantity = 10;
    dto.unitPrice = 0;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'unitPrice')).toBe(true);
  });

  it('rechaza un valor unitario negativo', async () => {
    const dto = new CreateQuoteItemDto();
    dto.description = 'Láminas adhesivas';
    dto.quantity = 10;
    dto.unitPrice = -100;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'unitPrice')).toBe(true);
  });
});