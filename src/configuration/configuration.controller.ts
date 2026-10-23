import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ConfigurationService } from './configuration.service.js';

export class ConfigurationDto {
  @ApiProperty({
    type: [String],
    description: 'Unique backend material UUIDs, including one glass vessel',
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  materialIds!: string[];
}
@ApiTags('Configuration')
@Controller('v1/configurations')
export class ConfigurationController {
  constructor(@Inject(ConfigurationService) private readonly configuration: ConfigurationService) {}
  @Post('validate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Validate current catalog rules. Does not create an order, invoice or binding quote.',
  })
  async validate(@Body() input: ConfigurationDto) {
    return this.configuration.validate(input);
  }
}
