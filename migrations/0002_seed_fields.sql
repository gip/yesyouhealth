INSERT INTO fields (id, slug, name) VALUES
  (1, 'diabetic-care',      'Diabetic Care'),
  (2, 'gi-health',          'GI Health'),
  (3, 'cardiology',         'Cardiology'),
  (4, 'mental-health',      'Mental Health'),
  (5, 'womens-health',      'Women''s Health'),
  (6, 'respiratory-health', 'Respiratory Health'),
  (7, 'oncology',           'Oncology'),
  (8, 'neurology',          'Neurology')
ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name;
