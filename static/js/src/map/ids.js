// Префиксы для типов элементов карты
export const PREFIX_GROUP = 'group_';
export const PREFIX_SHAPE = 'shape_';
export const PREFIX_LINK = 'link_';

// Создание ID с префиксом
export const makeGroupId = id => `${PREFIX_GROUP}${id}`;
export const makeShapeId = id => `${PREFIX_SHAPE}${id}`;
export const makeLinkId = id => `${PREFIX_LINK}${id}`;

// Проверка типа по ID
export const isGroupId = id => id.startsWith(PREFIX_GROUP);
export const isShapeId = id => id.startsWith(PREFIX_SHAPE);
export const isLinkId = id => id.startsWith(PREFIX_LINK);

// Извлечение числового ID из полного ID
export const parseRawId = id => {
    if (!id) return id;
    const match = String(id).match(/^(group|shape|link)_(.+)$/);
    return match ? match[2] : String(id);
};
