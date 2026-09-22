export class AppError extends Error {
    constructor(
        public statusCode: number,
        message: string,
    ) {
        super(message); // вызывает конструктор родительского класса Error с сообщением об ошибке
    }
}
