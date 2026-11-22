insert into public.shops(id, name) values ('10000000-0000-4000-8000-000000000001', 'Studio Auto') on conflict do nothing;
insert into public.services(id, shop_id, name, description, price_cents, duration_minutes) values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Lavagem detalhada','Limpeza minuciosa por dentro e por fora. Seu carro renovado em cada detalhe.',15000,90),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Polimento geral','Recupere o brilho da pintura com correção de marcas e acabamento refinado.',65000,240),
('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Higienização interna','Cuidado profundo com bancos, carpetes e superfícies do seu interior.',35000,180),
('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Proteção de pintura','Uma camada de proteção para preservar o brilho e facilitar os próximos cuidados.',90000,360)
on conflict do nothing;
